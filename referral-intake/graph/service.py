"""The served v2 pipeline: LangGraph running locally, a Postgres checkpointer,
and a real human-in-the-loop interrupt. OWNED BY LANE C; the names and
signatures below are frozen (docs/CONTRACTS.md, app.contracts.PipelineRunner).

    setup()        create the checkpointer tables (idempotent); the bootstrap script calls it
    structure()    nodes + edges of the compiled graph (build_graph().get_graph()), never hardcoded
    GraphRunner    PipelineRunner with name == "graph"; LangGraph thread_id == referral id

No LangSmith / LangChain-hosted services: tracing is app.trace (Postgres).
"""
from app.contracts import GraphStructure, PipelineRunner, ReferralRecord, ReviewAction


def setup() -> None:
    raise NotImplementedError("Lane C implements graph.service.setup()")


def structure() -> GraphStructure:
    raise NotImplementedError("Lane C implements graph.service.structure()")


class GraphRunner:
    name = "graph"

    def start(self, referral_id: str, pdf_path: str, source_name: str,
              replay_pace_s: float = 0.0) -> ReferralRecord:
        raise NotImplementedError("Lane C implements GraphRunner.start()")

    def resume(self, record: ReferralRecord, action: ReviewAction) -> ReferralRecord:
        raise NotImplementedError("Lane C implements GraphRunner.resume()")


def _check() -> PipelineRunner:  # the class must satisfy the protocol
    return GraphRunner()
