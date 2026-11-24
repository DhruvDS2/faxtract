"""Frozen contracts for the v2-ui run. See docs/CONTRACTS.md.

Every lane builds against these shapes. Changing one means asking the
orchestrator: the web mirror (web/src/contracts.ts), the API, both pipeline
runners and the benchmark writer all depend on them.

The extraction model itself (app.models.Referral) is frozen as-is.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from app.models import AuthRequirement, EligibilityResult, Flag, Referral

# --------------------------------------------------------------------------
# configuration that is part of the contract
# --------------------------------------------------------------------------

DEFAULT_CONFIDENCE_THRESHOLD = 0.85

# Claude Sonnet list price used by every cost number in the repo (dollars per
# million tokens). One place, so the eval artifact, the benchmark and the trace
# agree.
PRICE_PER_MTOK = {"input": 3.0, "output": 15.0}


def confidence_threshold() -> float:
    return float(os.getenv("CONFIDENCE_THRESHOLD", str(DEFAULT_CONFIDENCE_THRESHOLD)))


def pipeline_name() -> "PipelineName":
    value = os.getenv("PIPELINE", "graph").strip().lower()
    if value not in ("graph", "v1"):
        raise RuntimeError(f"PIPELINE={value!r} must be 'graph' or 'v1'")
    return value  # type: ignore[return-value]


def token_cost(usage: dict[str, int] | None) -> float:
    usage = usage or {}
    return (usage.get("input_tokens", 0) / 1e6 * PRICE_PER_MTOK["input"]
            + usage.get("output_tokens", 0) / 1e6 * PRICE_PER_MTOK["output"])


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# referral lifecycle
# --------------------------------------------------------------------------

PipelineName = Literal["graph", "v1"]

# At rest a referral is in exactly one of these. `auto_approved` and `approved`
# are transient (the order is being sent); a stored record normally shows
# `sent_to_ris` or `ris_error` instead.
ReferralStatus = Literal[
    "processing",     # pipeline running                         (gray)
    "needs_review",   # paused at human_review                   (amber)
    "auto_approved",  # passed the gate, no human needed; sending (green)
    "approved",       # reviewer approved; sending                (green)
    "sent_to_ris",    # RIS answered MSA|AA                       (green)
    "ris_error",      # RIS answered AE/AR or was unreachable; retryable (red)
    "rejected",       # reviewer rejected; terminal               (red)
    "failed",         # pipeline crashed before review (e.g. extraction) (red)
]

REVIEWABLE: tuple[str, ...] = ("needs_review",)
RETRYABLE: tuple[str, ...] = ("ris_error",)
REJECTABLE: tuple[str, ...] = ("needs_review", "ris_error")

EDITABLE_FIELDS: tuple[str, ...] = tuple(
    f for f in Referral.model_fields if f not in ("confidence", "boxes")
)


class PolicyCitation(BaseModel):
    source: str              # policy doc stem, e.g. "meridian-health__lumbar-mri"
    payor: str | None = None
    cpt: str | None = None
    score: float
    text: str


class PolicyResult(BaseModel):
    """GET /referrals/{id}/policy."""
    required: bool
    keywords: list[str] = Field(default_factory=list)
    citations: list[PolicyCitation] = Field(default_factory=list)


class OrderInfo(BaseModel):
    order_id: str | None = None
    message: str | None = None        # the HL7 ORM^O01 actually sent (\r-separated)
    ack_code: Literal["AA", "AE", "AR"] | None = None
    ack_raw: str | None = None
    attempts: int = 0
    last_error: str | None = None     # e.g. "connection refused (localhost:2575)"
    sent_at: datetime | None = None   # last attempt


class ReviewEvent(BaseModel):
    action: Literal["edit", "approve", "reject", "retry_send"]
    reviewer: str | None = None
    note: str | None = None           # approve note / reject reason
    fields: list[str] = Field(default_factory=list)  # edit: which fields changed
    at: datetime = Field(default_factory=utcnow)


class ReferralRecord(BaseModel):
    """What the API returns for one referral, for either pipeline."""
    id: str
    pipeline: PipelineName
    source_name: str                  # sanitized original upload name, e.g. "referral_013.pdf"
    source_file: str                  # server-side path of the stored PDF
    status: ReferralStatus
    referral: Referral
    flags: list[Flag] = Field(default_factory=list)        # validation output (latest)
    eligibility: EligibilityResult | None = None
    auth: AuthRequirement | None = None
    review_reasons: list[str] = Field(default_factory=list)  # why it was not auto-approved
    citations: list[PolicyCitation] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    packet_available: bool = False
    order: OrderInfo = Field(default_factory=OrderInfo)
    reviews: list[ReviewEvent] = Field(default_factory=list)
    stage_timings_ms: dict[str, float] = Field(default_factory=dict)
    token_usage: dict[str, int] = Field(default_factory=dict)
    cost_usd: float = 0.0
    error: str | None = None          # set when status is failed (and last RIS error mirrors order.last_error)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class OrderPreview(BaseModel):
    """GET /referrals/{id}/order: the ORM^O01 that approve would send (or did send)."""
    order_id: str
    message: str
    sent: bool                        # True once a send was attempted (then it is order.message)


class ReferralSummary(BaseModel):
    """One queue row. GET /referrals returns these, unsorted (the UI sorts)."""
    id: str
    pipeline: PipelineName
    source_name: str
    status: ReferralStatus
    patient_name: str | None          # "Last, First"
    patient_dob: str | None           # ISO date
    cpt_code: str | None
    requested_study: str | None
    payor_name: str | None
    member_id: str | None
    min_confidence: float | None      # lowest per-field confidence, None if no confidences
    error_count: int
    warning_count: int
    ack_code: Literal["AA", "AE", "AR"] | None
    created_at: datetime
    updated_at: datetime


# --------------------------------------------------------------------------
# request bodies
# --------------------------------------------------------------------------

class ReferralPatch(BaseModel):
    """PATCH /referrals/{id}. Values arrive as the UI types them (strings, null,
    or a list for icd10_codes) and are coerced through Referral; a value that does
    not parse is a 422, never a 500. icd10_codes also accepts one string split on
    commas, semicolons or whitespace."""
    fields: dict[str, Any]
    reviewer: str | None = None


class ApproveBody(BaseModel):
    reviewer: str | None = None
    note: str | None = None


class RejectBody(BaseModel):
    reason: str = Field(min_length=1)
    reviewer: str | None = None


class FieldError(BaseModel):
    field: str
    message: str


class ErrorBody(BaseModel):
    """Body of every 4xx the review API returns (422 adds `errors`, 409 adds `status`/`flags`)."""
    detail: str
    errors: list[FieldError] = Field(default_factory=list)
    status: ReferralStatus | None = None
    flags: list[Flag] = Field(default_factory=list)


# --------------------------------------------------------------------------
# what the API hands a pipeline runner
# --------------------------------------------------------------------------

class ReviewAction(BaseModel):
    kind: Literal["edit", "approve", "reject", "retry_send"]
    reviewer: str | None = None
    note: str | None = None
    referral: Referral | None = None          # edit: the full corrected referral, already coerced
    changed_fields: list[str] = Field(default_factory=list)


class PipelineRunner(Protocol):
    """Implemented by app.runner_v1 (Lane A) and graph.service (Lane C).

    Runners compute and return the record; the API persists it. Runners never
    touch the referrals table. They may emit trace events (app.trace.emit) and
    the graph runner owns its LangGraph checkpoint (thread_id == referral id).
    """
    name: PipelineName

    def start(self, referral_id: str, pdf_path: str, source_name: str,
              replay_pace_s: float = 0.0) -> ReferralRecord: ...

    def resume(self, record: ReferralRecord, action: ReviewAction) -> ReferralRecord: ...


# --------------------------------------------------------------------------
# trace events (one per node/stage execution)
# --------------------------------------------------------------------------

# A node emits `running` when it starts and one of ok/error/interrupted when it
# ends (two rows). `skipped` is never emitted by a run: the UI derives "skipped"
# for graph nodes with no event on the path taken.
TraceStatus = Literal["running", "ok", "error", "interrupted", "skipped"]


class TraceEvent(BaseModel):
    referral_id: str
    run_id: str                       # one per start()/resume() invocation
    seq: int = 0                      # assigned by app.trace.emit: 1, 2, 3... per referral
    pipeline: PipelineName
    node: str                         # graph node name, or v1 stage name
    status: TraceStatus
    started_at: datetime
    duration_ms: float
    cost_usd: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    attempt: int = 1                  # >1 means this node was retried (e.g. RIS send)
    branch: str | None = None         # routing decision taken after this node, e.g. "auth" / "human_review"
    detail: dict[str, Any] = Field(default_factory=dict)  # small, JSON-safe node summary
    error: str | None = None
    # Input/output state diff for the pipeline-graph screen. JSON-safe; the
    # referral's `boxes` are omitted. state_in = state the node received;
    # delta = what it wrote (for LangGraph, the node's returned update).
    # Only on the closing event (ok/error/interrupted), None on `running`.
    state_in: dict[str, Any] | None = None
    delta: dict[str, Any] | None = None


# --------------------------------------------------------------------------
# pipeline-graph screen: GET /graph/structure (from build_graph().get_graph())
# --------------------------------------------------------------------------

class GraphNode(BaseModel):
    id: str                           # LangGraph node id, incl. "__start__" / "__end__"
    label: str
    kind: Literal["start", "end", "node"]
    interrupts: bool = False          # can pause for a human (human_review, RIS retry wait)


class GraphEdge(BaseModel):
    source: str
    target: str
    conditional: bool
    label: str | None = None          # branch key for conditional edges


class GraphStructure(BaseModel):
    active_pipeline: PipelineName     # what PIPELINE the API is serving (header badge)
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# --------------------------------------------------------------------------
# referral detail: "Compare v1 vs v2" retrieval
# --------------------------------------------------------------------------

class RetrievedChunk(BaseModel):
    rank: int
    source: str
    payor: str | None = None
    cpt: str | None = None
    score: float
    text: str


class RetrieverRun(BaseModel):
    name: str                         # "v1 keyword" / "v2 3-step hybrid RAG"
    impl: str                         # "app.policy.retrieve" / "app.rag.retrieve_3step"
    latency_ms: float
    keywords: list[str] = Field(default_factory=list)
    chunks: list[RetrievedChunk]


class RetrievalCompare(BaseModel):
    referral_id: str
    query: dict[str, Any]             # {"indication", "codes", "payor"}
    expected_source: str | None       # the payor+CPT policy doc that should win, if one exists
    v1: RetrieverRun
    v2: RetrieverRun


# --------------------------------------------------------------------------
# RIS orders screen
# --------------------------------------------------------------------------

class RisOrderRow(BaseModel):
    referral_id: str
    order_id: str | None
    patient_name: str | None
    cpt_code: str | None
    status: ReferralStatus
    ack_code: Literal["AA", "AE", "AR"] | None
    attempts: int
    last_error: str | None
    sent_at: datetime | None
    in_ris: bool                      # the order id is present in the RIS store
    retryable: bool


# --------------------------------------------------------------------------
# evals screen
# --------------------------------------------------------------------------

class Count(BaseModel):
    hits: int
    n: int


class Percentiles(BaseModel):
    p50: float
    p95: float
    mean: float | None = None
    n: int | None = None


class PipelineBenchmark(BaseModel):
    pipeline: PipelineName
    retriever: str                                   # e.g. "app.policy.retrieve (keyword)"
    retrieval_hit_at_1_with_cpt: Count
    retrieval_hit_at_1_without_cpt: Count
    auto_approved: int
    false_approvals: int                             # auto-approved with >=1 critical field wrong
    false_approval_files: list[str]
    latency_ms: Percentiles                          # end-to-end per referral, excluding human time
    extraction_latency_ms: Percentiles | None = None  # recorded extraction latency (replay) or live
    cost_per_referral_usd: float
    node_timings_ms: dict[str, Percentiles] = Field(default_factory=dict)  # v2: per node


class FalseApprovalCase(BaseModel):
    file: str
    pipelines: list[PipelineName]
    field: str
    predicted: Any
    truth: Any
    confidence: float | None
    explanation: str


class BenchmarkReport(BaseModel):
    """evals/benchmark_v1_v2.json. Written by Lane C, rendered by the evals screen."""
    schema_version: Literal[1] = 1
    generated_at: datetime
    git_commit: str | None
    threshold: float
    corpus: dict[str, Any]             # {"n": 60, "seed": 42, "ground_truth_sha256": ..., "truth_version": ...}
    extraction: dict[str, Any]         # {"engine": "replay", "source": "evals/extraction_eval.json", "model": ..., "note": ...}
    critical_fields: list[str]
    v1: PipelineBenchmark
    v2: PipelineBenchmark
    false_approval_cases: list[FalseApprovalCase]
    notes: list[str] = Field(default_factory=list)


class ArtifactEnvelope(BaseModel):
    """GET /evals/benchmark and GET /evals/extraction wrap the committed file in this."""
    source: str                        # repo-relative path of the artifact
    run_at: datetime | None            # when the run happened
    run_at_source: Literal["artifact", "git", "unknown"]
    data: dict[str, Any]


class Health(BaseModel):
    ok: bool
    db: bool
    ris: Literal["up", "down"]
    pipeline: PipelineName
    extractor: str
    threshold: float
