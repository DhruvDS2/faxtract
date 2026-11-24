"""The served v2 pipeline: LangGraph running locally, a Postgres checkpointer,
and a real human-in-the-loop interrupt. OWNED BY LANE C; the names and
signatures below are frozen (docs/CONTRACTS.md, app.contracts.PipelineRunner).

    setup()        create the checkpointer tables (idempotent); the bootstrap script calls it
    structure()    nodes + edges of the compiled graph (build_graph().get_graph()), never hardcoded
    GraphRunner    PipelineRunner with name == "graph"; LangGraph thread_id == referral id
    reset()        close the shared connection pool (tests switch databases with it)

Checkpoints live in the same Postgres as everything else (app.db.libpq_url()),
through one psycopg ConnectionPool per process (autocommit, dict_row,
prepare_threshold=0, as langgraph-checkpoint-postgres expects). The pool and the
compiled graph are shared by every GraphRunner, so the API's worker threads can
use runners concurrently. A referral paused at human_review survives process
restarts: a brand-new GraphRunner resumes it from its checkpoint.

No LangSmith / LangChain-hosted services: tracing is app.trace (Postgres).
"""
import atexit
import threading
import uuid
from pathlib import Path

from langgraph.types import Command

from app.contracts import (GraphEdge, GraphNode, GraphStructure, OrderInfo, PipelineRunner,
                           PolicyCitation, ReferralRecord, ReviewAction, pipeline_name,
                           token_cost, utcnow)
from app.db import libpq_url
from app.models import Referral
from graph.pipeline import build_graph, gate_reasons
from graph.state import auth_of, eligibility_of, flags_of, initial_state
from graph.tracing import RUN_ID_KEY

POOL_MAX = 20

# Which pause accepts which ReviewAction kinds.
PAUSES = {"human_review": ("edit", "approve", "reject"), "ris_wait": ("retry_send", "reject")}

_lock = threading.Lock()
_pool = None
_pool_url = None
_compiled = None


def _graph():
    """The compiled graph bound to the shared PostgresSaver (created on first use,
    and again if DATABASE_URL now points somewhere else)."""
    global _pool, _pool_url, _compiled
    url = libpq_url()  # raises DatabaseNotConfigured when DATABASE_URL is unset
    with _lock:
        if _pool is not None and _pool_url != url:
            _close_locked()
        if _compiled is None:
            from langgraph.checkpoint.postgres import PostgresSaver
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool

            pool = ConnectionPool(
                conninfo=url, min_size=1, max_size=POOL_MAX, open=True,
                kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
            )
            try:
                pool.wait(timeout=15)
                saver = PostgresSaver(pool)
                saver.setup()  # idempotent: creates/migrates the checkpoint tables
            except Exception:
                pool.close()
                raise
            _pool, _pool_url, _compiled = pool, url, build_graph(checkpointer=saver)
        return _compiled


def _close_locked():
    global _pool, _pool_url, _compiled
    if _pool is not None:
        _pool.close()
    _pool = _pool_url = _compiled = None


def reset() -> None:
    """Close the shared pool and forget the compiled graph. The next use reconnects
    to whatever DATABASE_URL says then."""
    with _lock:
        _close_locked()


atexit.register(reset)


def setup() -> None:
    """Create the LangGraph checkpointer tables in DATABASE_URL's database. Idempotent."""
    _graph()


def structure() -> GraphStructure:
    """The compiled graph's nodes and edges, for GET /graph/structure."""
    drawn = build_graph().get_graph()
    nodes = []
    for node_id, node in drawn.nodes.items():
        kind = "start" if node_id == "__start__" else "end" if node_id == "__end__" else "node"
        label = {"start": "start", "end": "end"}.get(kind, node_id.replace("_", " "))
        nodes.append(GraphNode(id=node_id, label=label, kind=kind,
                               interrupts=bool((node.metadata or {}).get("interrupts"))))
    # LangGraph leaves `data` empty when a branch key equals its target's name
    # ("reject" -> reject); the key is still the label.
    edges = [GraphEdge(source=e.source, target=e.target, conditional=bool(e.conditional),
                       label=(str(e.data) if e.data is not None else e.target) if e.conditional else None)
             for e in drawn.edges]
    return GraphStructure(active_pipeline=pipeline_name(), nodes=nodes, edges=edges)


def _config(referral_id: str, run_id: str) -> dict:
    return {"configurable": {"thread_id": referral_id, RUN_ID_KEY: run_id}}


def paused_at(snapshot) -> str | None:
    """The node a thread is paused in (human_review / ris_wait), or None."""
    for task in snapshot.tasks or ():
        if task.interrupts:
            return task.name
    return None


class GraphRunner:
    """app.contracts.PipelineRunner over the LangGraph. Computes and returns the
    record; never writes the referrals table (the API persists what it gets)."""

    name = "graph"

    def start(self, referral_id: str, pdf_path: str, source_name: str,
              replay_pace_s: float = 0.0) -> ReferralRecord:
        graph = _graph()
        config = _config(referral_id, uuid.uuid4().hex)
        if graph.get_state(config).values:
            raise ValueError(f"referral {referral_id} already has a graph thread; ids must be new")
        state = initial_state(referral_id, str(pdf_path), source_name, replay_pace_s)
        crash = self._invoke(graph, state, config)
        return self._record(graph, config, base=None, crash=crash)

    def resume(self, record: ReferralRecord, action: ReviewAction) -> ReferralRecord:
        graph = _graph()
        config = _config(record.id, uuid.uuid4().hex)
        snapshot = graph.get_state(config)
        pause = paused_at(snapshot)
        if pause is None:
            status = (snapshot.values or {}).get("status", "unknown")
            raise ValueError(f"referral {record.id} is not paused in the graph (status {status})")
        if action.kind not in PAUSES[pause]:
            raise ValueError(f"{pause} accepts {', '.join(PAUSES[pause])}, not {action.kind}")
        if action.kind == "edit" and action.referral is None:
            raise ValueError("an edit must carry the corrected referral")
        crash = self._invoke(graph, Command(resume=action.model_dump(mode="json")), config)
        return self._record(graph, config, base=record, crash=crash)

    # ------------------------------------------------------------------

    @staticmethod
    def _invoke(graph, payload, config) -> str | None:
        """Run until the graph ends or pauses. A crash is returned, not raised:
        the record then says `failed` with the reason."""
        try:
            graph.invoke(payload, config)
        except Exception as exc:
            return f"{type(exc).__name__}: {exc}"
        return None

    @staticmethod
    def _record(graph, config, base: ReferralRecord | None, crash: str | None) -> ReferralRecord:
        snapshot = graph.get_state(config)
        v = snapshot.values or {}
        pause = paused_at(snapshot)

        status, error = v.get("status") or "processing", v.get("error")
        if crash:
            status, error = "failed", crash
        elif pause == "human_review":
            status = "needs_review"
        elif pause == "ris_wait":
            status = "ris_error"

        usage = v.get("usage") or {}
        packet = v.get("packet_path")
        now = utcnow()
        return ReferralRecord(
            id=v.get("referral_id") or config["configurable"]["thread_id"],
            pipeline=base.pipeline if base else "graph",
            source_name=base.source_name if base else v.get("source_name", ""),
            source_file=base.source_file if base else v.get("source_file", ""),
            status=status,
            referral=Referral.model_validate(v["referral"]) if v.get("referral") else Referral(),
            flags=flags_of(v),
            eligibility=eligibility_of(v),
            auth=auth_of(v),
            review_reasons=gate_reasons(v),
            citations=[PolicyCitation.model_validate(c) for c in v.get("citations") or []],
            keywords=list(v.get("keywords") or []),
            packet_available=bool(packet and Path(packet).exists()),
            order=OrderInfo.model_validate(v.get("order") or {}),
            reviews=list(base.reviews) if base else [],
            stage_timings_ms=dict(v.get("stage_timings_ms") or {}),
            token_usage={k: int(usage[k]) for k in ("input_tokens", "output_tokens") if k in usage},
            cost_usd=token_cost(usage),
            error=error,
            created_at=base.created_at if base else now,
            updated_at=now,
        )


def _check() -> PipelineRunner:  # the class must satisfy the protocol
    return GraphRunner()
