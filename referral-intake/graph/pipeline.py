"""v2 pipeline as a LangGraph.

Nodes reuse v1's bodies from app/ (v1 is left untouched). The Prior-Auth-Retrieval
node is where the 3-step hybrid RAG (app/rag.py) plugs in. The two decision diamonds
from the authoritative workflow are conditional edges: 271-status and prior-auth-required.
"""

import uuid
from pathlib import Path

from langgraph.graph import END, START, StateGraph

from app import rag
from app.auth_packet import auth_requirement, build_packet
from app.edi import build_270, parse_271
from app.extract import extract
from app.hl7 import build_orm
from app.payor import respond
from app.validate import validate
from graph.state import GraphState

CLINIC_NPI = "1234567893"
PACKETS = Path(__file__).parent.parent / "packets"


def extract_node(state: GraphState):
    if state.referral is not None:      # referral pre-supplied (demo / already read)
        return {}
    referral, _ = extract(state.source_file)
    return {"referral": referral}


def validate_node(state: GraphState):
    return {"flags": validate(state.referral, 0.85)}


def human_review_node(state: GraphState):
    # The mandatory human field-check. The real interrupt/checkpoint lives here;
    # for a straight-through run it passes the referral along unchanged.
    return {}


def eligibility_node(state: GraphState):
    edi_270 = build_270(state.referral, CLINIC_NPI)
    return {"eligibility": parse_271(respond(edi_270))}


def route_271(state: GraphState):
    if state.eligibility.status in ("active_in_network", "active_out_of_network"):
        return "auth"
    return "exception"


def exception_node(state: GraphState):
    return {"status": "coverage_exception"}


def auth_node(state: GraphState):
    return {"auth": auth_requirement(state.referral)}


def route_auth(state: GraphState):
    return "retrieve" if state.auth.required else "order"


def retrieve_node(state: GraphState):
    r = state.referral
    indication = r.clinical_indication or r.requested_study or ""
    codes = [c for c in [r.cpt_code, *r.icd10_codes] if c]
    out = rag.retrieve_3step(indication, codes, r.payor_name, k=3)
    citations = [{"path": ch["source"], "text": ch["text"]} for ch, _ in out["results"]]
    top = out["results"][0][0]["text"] if out["results"] else None
    return {"retrieved_citations": citations, "keywords": out["keywords"], "retrieved_policy": top}


def packet_node(state: GraphState):
    PACKETS.mkdir(exist_ok=True)
    out = PACKETS / f"auth_{state.referral.member_id or 'unknown'}.pdf"
    build_packet(state.referral, state.eligibility, state.retrieved_citations, out)
    return {"packet_path": str(out)}


def order_node(state: GraphState):
    rid = uuid.uuid4().hex[:8].upper()
    msg = build_orm(state.referral, "ORD" + rid, "MRN" + rid, "MSG" + rid)
    return {"order_message": msg, "status": "order_ready"}


def build_graph():
    g = StateGraph(GraphState)
    for name, fn in [
        ("extract", extract_node), ("validate", validate_node),
        ("human_review", human_review_node), ("eligibility", eligibility_node),
        ("exception", exception_node), ("auth", auth_node),
        ("retrieve", retrieve_node), ("packet", packet_node), ("order", order_node),
    ]:
        g.add_node(name, fn)

    g.add_edge(START, "extract")
    g.add_edge("extract", "validate")
    g.add_edge("validate", "human_review")
    g.add_edge("human_review", "eligibility")
    g.add_conditional_edges("eligibility", route_271, {"auth": "auth", "exception": "exception"})
    g.add_conditional_edges("auth", route_auth, {"retrieve": "retrieve", "order": "order"})
    g.add_edge("retrieve", "packet")
    g.add_edge("packet", "order")
    g.add_edge("order", END)
    g.add_edge("exception", END)
    return g.compile()


if __name__ == "__main__":
    import json
    import os

    from app.models import Referral

    # load .env so the (optional) vision extract / LLM step-2 can find the key
    env = Path(__file__).parent.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

    # pick a demo referral from ground truth that reaches the packet path:
    # eligibility active AND prior auth required (skips the vision call for a fast, reliable run)
    gt = json.load(open(Path(__file__).parent.parent / "corpus" / "out" / "ground_truth.json"))
    rows = gt if isinstance(gt, list) else gt.get("referrals", list(gt.values()))

    chosen = None
    for row in rows:
        ref = Referral(**{k: v for k, v in row.items() if k in Referral.model_fields})
        elig = parse_271(respond(build_270(ref, CLINIC_NPI)))
        if elig.status.startswith("active") and auth_requirement(ref).required:
            chosen = ref
            break

    graph = build_graph()
    print(f"referral: {chosen.payor_name} | {chosen.requested_study} (CPT {chosen.cpt_code})")
    print(f'indication: "{chosen.clinical_indication}"\n')
    print("--- graph running ---")

    final = {}
    for update in graph.stream({"source_file": "demo", "referral": chosen}, stream_mode="updates"):
        for node, delta in update.items():
            delta = delta or {}
            note = ""
            if node == "eligibility":
                note = f"-> 271 status: {delta['eligibility'].status}"
            elif node == "auth":
                note = f"-> prior auth required: {delta['auth'].required}"
            elif node == "retrieve":
                note = f"-> step-2 keywords: {delta['keywords'][:4]}..."
            elif node == "packet":
                note = f"-> packet: {Path(delta['packet_path']).name}"
            elif node == "order":
                note = f"-> ORM built ({len(delta['order_message'].splitlines())} segments)"
            print(f"  [{node}]  {note}")
            final.update(delta)

    print("\n--- done ---")
    print(f"packet PDF: {final.get('packet_path')}")
    print(f"order (first segment): {final.get('order_message', '').splitlines()[0] if final.get('order_message') else 'n/a'}")
