"""The graph's state: what every node reads and what its update writes.

Everything is plain JSON (Pydantic models are stored as model_dump(mode="json")
dicts). That keeps the Postgres checkpoints portable and makes the trace's
state_in / delta a straight copy. Nodes rebuild models with the helpers below.
"""
from typing import Annotated, Any, TypedDict

from app.contracts import OrderInfo
from app.models import AuthRequirement, EligibilityResult, Flag, Referral


def merge(left: dict | None, right: dict | None) -> dict:
    """Reducer for per-node bookkeeping maps: the update wins key by key."""
    return {**(left or {}), **(right or {})}


class GraphState(TypedDict, total=False):
    # -- input (GraphRunner.start)
    referral_id: str              # also the LangGraph thread_id
    source_file: str              # the stored PDF
    source_name: str              # original upload name, e.g. referral_013.pdf
    replay_pace_s: float          # replay engine pacing (seconds)

    # -- written by nodes
    referral: dict | None         # Referral (JSON), incl. confidence + boxes
    usage: dict                   # extraction token usage (+ replayed_latency_ms)
    flags: list[dict]             # Flag (JSON), latest validation
    eligibility: dict | None      # EligibilityResult (JSON)
    auth: dict | None             # AuthRequirement (JSON)
    citations: list[dict]         # PolicyCitation (JSON)
    keywords: list[str]           # 3-step RAG step-2 vocabulary
    packet_path: str | None       # packets/<referral_id>.pdf
    order: dict                   # OrderInfo (JSON)
    approved_by: str | None       # "gate" (auto) or "reviewer"
    edited: bool                  # a reviewer changed fields: never auto-send after this
    review: dict | None           # the last ReviewAction a pause was resumed with
    status: str                   # app.contracts.ReferralStatus
    error: str | None

    # -- bookkeeping, added by the trace wrapper (not part of a node's own delta)
    stage_timings_ms: Annotated[dict[str, float], merge]
    node_runs: Annotated[dict[str, int], merge]


BOOKKEEPING = ("stage_timings_ms", "node_runs")


def initial_state(referral_id: str, source_file: str, source_name: str,
                  replay_pace_s: float = 0.0) -> GraphState:
    return GraphState(
        referral_id=referral_id, source_file=str(source_file), source_name=source_name,
        replay_pace_s=float(replay_pace_s or 0.0),
        referral=None, usage={}, flags=[], eligibility=None, auth=None,
        citations=[], keywords=[], packet_path=None,
        order=OrderInfo().model_dump(mode="json"), approved_by=None, edited=False,
        review=None, status="processing", error=None,
    )


def dump(model) -> Any:
    return None if model is None else model.model_dump(mode="json")


def referral_of(state) -> Referral:
    return Referral.model_validate(state["referral"])


def flags_of(state) -> list[Flag]:
    return [Flag.model_validate(f) for f in state.get("flags") or []]


def eligibility_of(state) -> EligibilityResult | None:
    e = state.get("eligibility")
    return EligibilityResult.model_validate(e) if e else None


def auth_of(state) -> AuthRequirement | None:
    a = state.get("auth")
    return AuthRequirement.model_validate(a) if a else None


def order_of(state) -> OrderInfo:
    return OrderInfo.model_validate(state.get("order") or {})
