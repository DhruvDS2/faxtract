"""v2 pipeline as a LangGraph: the nodes, their routing, and build_graph().

    START -> extract -> validate -> eligibility --active--> auth --auth required--> retrieve -> packet
                 |                      |                    |--auto--> order               |--auto--> order
               failed                inactive                '--review--> human_review      '--review--> human_review
                 v                      v
                END               human_review --approve--> order --sent--> END
                                       |--edit--> validate (re-check everything, pause again)
                                       '--reject--> reject -> END
                                  order --ris error--> ris_wait --retry--> order (attempt + 1)
                                                               '--reject--> reject

The gate (app.gate.review_reasons) is the same rule v1 uses: no validation
flags at the threshold, coverage active, no missing prior-auth elements. A
referral a reviewer has edited never auto-sends; it pauses for approval.

human_review and ris_wait pause with langgraph.types.interrupt(); the
GraphRunner (graph.service) resumes them with Command(resume=<ReviewAction>).
order really sends the HL7 ORM^O01 over MLLP and records the ACK.

Demo:  python -m graph.pipeline corpus/out/referral_013.pdf   (see graph/cli.py)
"""
import os
import socket
from pathlib import Path

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app import rag
from app.auth_packet import auth_requirement, build_packet
from app.contracts import OrderInfo, PolicyCitation, ReviewAction, confidence_threshold, utcnow
from app.edi import build_270, parse_271
from app.extract import engine_name, extract
from app.gate import review_reasons
from app.hl7 import build_orm, send_mllp
from app.payor import respond
from app.pipeline import CLINIC_NPI
from app.validate import validate
from graph.state import (GraphState, auth_of, dump, eligibility_of, flags_of, order_of,
                         referral_of)
from graph.tracing import traced

ROOT = Path(__file__).parent.parent
PACKETS = ROOT / "packets"

ACTIVE = ("active_in_network", "active_out_of_network")
SEND_TIMEOUT_S = 10.0
RETRIEVE_K = 3

# Nodes that can pause for a person; carried into get_graph() as node metadata.
INTERRUPTS = {"interrupts": True}


def ris_address() -> tuple[str, int]:
    """Where the RIS listens, read at send time (RIS_MLLP_HOST / RIS_MLLP_PORT)."""
    return (os.getenv("RIS_MLLP_HOST") or "127.0.0.1", int(os.getenv("RIS_MLLP_PORT") or 2575))


def parse_ack(ack: str) -> tuple[str | None, str]:
    """(code, text) from the MSA segment of an HL7 ACK: MSA|<code>|<control id>|<text>."""
    for segment in (ack or "").replace("\n", "\r").split("\r"):
        if segment.startswith("MSA|"):
            parts = segment.split("|")
            code = parts[1].strip() if len(parts) > 1 else None
            text = parts[3].strip() if len(parts) > 3 else ""
            return code or None, text
    return None, ""


def gate_reasons(state) -> list[str]:
    """app.gate.review_reasons over the current state (empty == clean)."""
    if not state.get("referral"):
        return []
    return review_reasons(flags_of(state), eligibility_of(state), auth_of(state))


def _gate(state) -> str:
    return "review" if state.get("edited") or gate_reasons(state) else "auto"


# --------------------------------------------------------------------------
# node bodies: state in, update out (JSON only)
# --------------------------------------------------------------------------

def extract_node(state: GraphState) -> dict:
    try:
        referral, usage = extract(state["source_file"], replay_pace_s=state.get("replay_pace_s") or 0.0)
    except Exception as exc:
        return {"status": "failed", "error": f"extraction failed: {type(exc).__name__}: {exc}"}
    return {"referral": dump(referral), "usage": dict(usage or {})}


def validate_node(state: GraphState) -> dict:
    flags = validate(referral_of(state), confidence_threshold())
    return {"flags": [dump(f) for f in flags]}


def eligibility_node(state: GraphState) -> dict:
    elig = parse_271(respond(build_270(referral_of(state), CLINIC_NPI)))
    out = {"eligibility": dump(elig)}
    if elig.status not in ACTIVE:
        # Inactive coverage goes straight to review; drop any auth/packet work
        # from an earlier pass so the record describes this pass only.
        out.update(auth=None, citations=[], keywords=[], packet_path=None)
    return out


def auth_node(state: GraphState) -> dict:
    auth = auth_requirement(referral_of(state))
    out = {"auth": dump(auth)}
    if not auth.required:
        out.update(citations=[], keywords=[], packet_path=None)
    return out


def retrieve_node(state: GraphState) -> dict:
    q = rag.referral_query(referral_of(state))
    found = rag.retrieve_3step(q["indication"], q["codes"], q["payor"], k=RETRIEVE_K)
    citations = [
        PolicyCitation(source=rag.source_stem(chunk["source"]), payor=chunk.get("payor"),
                       cpt=chunk.get("cpt"), score=round(float(score), 4), text=chunk["text"])
        for chunk, score in found["results"]
    ]
    return {"citations": [dump(c) for c in citations], "keywords": list(found["keywords"])}


def packet_node(state: GraphState) -> dict:
    PACKETS.mkdir(parents=True, exist_ok=True)
    path = PACKETS / f"{state['referral_id']}.pdf"
    cited = [{"path": c["source"], "text": c["text"]} for c in state.get("citations") or []]
    build_packet(referral_of(state), eligibility_of(state), cited, path)
    return {"packet_path": str(path)}


def human_review_node(state: GraphState) -> dict:
    # Everything above interrupt() runs again on resume, so it must stay pure.
    reasons = gate_reasons(state)
    answer = interrupt({"node": "human_review", "status": "needs_review",
                        "review_reasons": reasons, "allowed": ["edit", "approve", "reject"]})
    action = ReviewAction.model_validate(answer)
    if action.kind == "edit":
        if action.referral is None:
            raise ValueError("an edit must carry the corrected referral")
        edited = dump(action.referral)
        if not edited.get("boxes") and state.get("referral"):
            edited["boxes"] = state["referral"].get("boxes", {})  # where values were read
        return {"referral": edited, "edited": True, "review": dump(action), "status": "needs_review"}
    if action.kind == "approve":
        return {"status": "approved", "approved_by": "reviewer", "review": dump(action)}
    if action.kind == "reject":
        return {"review": dump(action)}
    raise ValueError(f"human_review cannot {action.kind}; expected edit, approve or reject")


def order_node(state: GraphState) -> dict:
    previous = order_of(state)
    attempt = previous.attempts + 1
    rid = state["referral_id"].upper()
    order_id, mrn, message_id = f"ORD{rid}", f"MRN{rid}", f"MSG{rid}-{attempt}"
    message = build_orm(referral_of(state), order_id, mrn, message_id)
    host, port = ris_address()
    info = OrderInfo(order_id=order_id, message=message, attempts=attempt, sent_at=utcnow())
    try:
        ack = send_mllp(message, host=host, port=port, timeout=SEND_TIMEOUT_S)
    except ConnectionRefusedError:
        info.last_error = f"connection refused ({host}:{port})"
    except (TimeoutError, socket.timeout):
        info.last_error = f"no answer within {SEND_TIMEOUT_S:g}s ({host}:{port})"
    except OSError as exc:
        info.last_error = f"{type(exc).__name__}: {exc} ({host}:{port})"
    else:
        info.ack_raw = ack
        code, text = parse_ack(ack)
        info.ack_code = code if code in ("AA", "AE", "AR") else None
        if code is None:
            info.last_error = "RIS reply had no MSA segment"
        elif code != "AA":
            info.last_error = f"RIS answered MSA|{code}" + (f": {text}" if text else "")
    status = "sent_to_ris" if info.ack_code == "AA" else "ris_error"
    approved_by = state.get("approved_by") or ("reviewer" if state.get("status") == "approved" else "gate")
    return {"order": dump(info), "status": status, "error": info.last_error, "approved_by": approved_by}


def ris_wait_node(state: GraphState) -> dict:
    answer = interrupt({"node": "ris_wait", "status": "ris_error",
                        "last_error": order_of(state).last_error, "allowed": ["retry_send", "reject"]})
    action = ReviewAction.model_validate(answer)
    if action.kind not in ("retry_send", "reject"):
        raise ValueError(f"ris_wait cannot {action.kind}; expected retry_send or reject")
    return {"review": dump(action)}


def reject_node(state: GraphState) -> dict:
    return {"status": "rejected", "error": None}


# --------------------------------------------------------------------------
# routing (each returns a key of its path map; the keys are the edge labels)
# --------------------------------------------------------------------------

def route_extract(state) -> str:
    return "failed" if state.get("status") == "failed" else "ok"


def route_eligibility(state) -> str:
    e = state.get("eligibility") or {}
    return "active" if e.get("status") in ACTIVE else "inactive"


def route_auth(state) -> str:
    if (state.get("auth") or {}).get("required"):
        return "auth required"
    return _gate(state)


def route_packet(state) -> str:
    return _gate(state)


def route_review(state) -> str:
    return (state.get("review") or {}).get("kind", "approve")


def route_order(state) -> str:
    return "sent" if state.get("status") == "sent_to_ris" else "ris error"


def route_ris_wait(state) -> str:
    return "retry" if (state.get("review") or {}).get("kind") == "retry_send" else "reject"


PATHS = {
    "extract": (route_extract, {"ok": "validate", "failed": END}),
    "eligibility": (route_eligibility, {"active": "auth", "inactive": "human_review"}),
    "auth": (route_auth, {"auth required": "retrieve", "auto": "order", "review": "human_review"}),
    "packet": (route_packet, {"auto": "order", "review": "human_review"}),
    "human_review": (route_review, {"approve": "order", "edit": "validate", "reject": "reject"}),
    "order": (route_order, {"sent": END, "ris error": "ris_wait"}),
    "ris_wait": (route_ris_wait, {"retry": "order", "reject": "reject"}),
}
EDGES = {"validate": "eligibility", "retrieve": "packet", "reject": END}


# --------------------------------------------------------------------------
# trace summaries (TraceEvent.detail)
# --------------------------------------------------------------------------

def _detail(name):
    def summarize(merged, delta):
        if name == "extract":
            if delta.get("status") == "failed":
                return {}
            usage = delta.get("usage") or {}
            return {"engine": engine_name(),
                    "fields": len([k for k, v in (delta.get("referral") or {}).items()
                                   if k not in ("confidence", "boxes") and v not in (None, "", [], {})]),
                    "replayed_latency_ms": usage.get("replayed_latency_ms")}
        if name == "validate":
            flags = delta.get("flags") or []
            return {"flags": len(flags), "errors": sum(f["severity"] == "error" for f in flags)}
        if name == "eligibility":
            return {"coverage": (delta.get("eligibility") or {}).get("status")}
        if name == "auth":
            a = delta.get("auth") or {}
            return {"required": a.get("required"), "missing": a.get("missing_elements", []),
                    "review_reasons": gate_reasons(merged)}
        if name == "retrieve":
            cites = delta.get("citations") or []
            return {"top": cites[0]["source"] if cites else None, "k": len(cites),
                    "keywords": delta.get("keywords", [])}
        if name == "packet":
            return {"packet": Path(delta.get("packet_path") or "").name, "review_reasons": gate_reasons(merged)}
        if name in ("human_review", "ris_wait"):
            review = delta.get("review") or {}
            return {"action": review.get("kind"), "changed_fields": review.get("changed_fields", []),
                    "reviewer": review.get("reviewer")}
        if name == "order":
            o = delta.get("order") or {}
            return {"order_id": o.get("order_id"), "ack": o.get("ack_code"),
                    "last_error": o.get("last_error"), "approved_by": delta.get("approved_by")}
        return {}
    return summarize


def _order_attempt(state) -> int:
    return order_of(state).attempts + 1


BODIES = {
    "extract": extract_node, "validate": validate_node, "eligibility": eligibility_node,
    "auth": auth_node, "retrieve": retrieve_node, "packet": packet_node,
    "human_review": human_review_node, "order": order_node, "ris_wait": ris_wait_node,
    "reject": reject_node,
}


def build_graph(checkpointer=None):
    """The compiled v2 graph. Without a checkpointer it can't pause/resume; it is
    still what structure() draws (graph.service)."""
    g = StateGraph(GraphState)
    for name, body in BODIES.items():
        router, path_map = PATHS.get(name, (None, None))
        node = traced(name, body, router=router, path_map=path_map, next_node=EDGES.get(name),
                      detail=_detail(name), attempt_of=_order_attempt if name == "order" else None)
        g.add_node(name, node, metadata=INTERRUPTS if name in ("human_review", "ris_wait") else None)

    g.add_edge(START, "extract")
    for name, target in EDGES.items():
        g.add_edge(name, target)
    for name, (router, path_map) in PATHS.items():
        g.add_conditional_edges(name, router, path_map)
    return g.compile(checkpointer=checkpointer)


if __name__ == "__main__":
    from graph.cli import main

    main()
