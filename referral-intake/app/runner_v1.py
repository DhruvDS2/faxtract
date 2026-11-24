"""V1Runner: the PipelineRunner for PIPELINE=v1 (docs/CONTRACTS.md §6).

It wraps the v1 baseline, app.pipeline.process, which stays untouched, and puts
it under the frozen lifecycle:

    start   process() -> the shared gate (app.gate.review_reasons, identical to
            v1's rule) -> auto_approved: send the ORM now / needs_review: pause
    resume  edit       re-validate at confidence_threshold(), redo eligibility,
                       auth and review reasons; stays needs_review (a human approves)
            approve    send the ORM
            reject     terminal
            retry_send re-send the stored ORM (new MSH-10), attempts + 1

Trace: every v1 stage (extract, validate, eligibility, auth, gate, human_review,
order, reject) emits a `running` event and a closing event with state_in/delta
(referral boxes omitted) through app.trace.emit. One run_id per start/resume.

How process() is wrapped. process() calls `extract(pdf_path)` through its own
module global. While V1Runner.start is running (and only then: a context
variable scopes it to that call, per thread) that call goes through a hook here
which (a) passes replay_pace_s to the extractor, (b) emits the extract trace
events in real time, and (c) hands process() the token usage as integers -- the
replay engine reports `replayed_latency_ms` as a float, which
ProcessedReferral.token_usage (dict[str, int]) rejects. Outside V1Runner.start
the hook is a pure pass-through.

Runners never write the referrals table: they return the record and the API
persists it, appends the ReviewEvent and sets updated_at.
"""
from __future__ import annotations

import contextvars
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable

import app.pipeline as v1
from app import hl7, trace
from app.auth_packet import auth_requirement
from app.contracts import (OrderInfo, ReferralRecord, ReviewAction, TraceEvent,
                           confidence_threshold, token_cost, utcnow)
from app.edi import build_270, parse_271
from app.extract import extract as _extract
from app.gate import review_reasons
from app.models import Referral
from app.payor import respond
from app.validate import validate

log = logging.getLogger("faxtract.v1")

PIPELINE = "v1"


# --------------------------------------------------------------------------
# trace helpers
# --------------------------------------------------------------------------

def referral_state(referral: Referral) -> dict:
    return referral.model_dump(mode="json", exclude={"boxes"})


def _dump(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_dump(v) for v in value]
    if isinstance(value, dict):
        return {k: _dump(v) for k, v in value.items()}
    return value


@dataclass
class _Tracer:
    referral_id: str
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex)

    def _emit(self, **kw) -> None:
        try:
            trace.emit(TraceEvent(referral_id=self.referral_id, run_id=self.run_id, pipeline=PIPELINE, **kw))
        except Exception:  # tracing must never take a referral down with it
            log.exception("trace emit failed for %s %s", self.referral_id, kw.get("node"))

    def running(self, node: str, started_at: datetime, attempt: int = 1) -> None:
        self._emit(node=node, status="running", started_at=started_at, duration_ms=0.0, attempt=attempt)

    def close(self, node: str, status: str, started_at: datetime, duration_ms: float, *,
              state_in: dict | None = None, delta: dict | None = None, branch: str | None = None,
              detail: dict | None = None, error: str | None = None, attempt: int = 1,
              usage: dict | None = None) -> None:
        usage = usage or {}
        self._emit(node=node, status=status, started_at=started_at, duration_ms=duration_ms,
                   state_in=_dump(state_in), delta=_dump(delta), branch=branch, detail=_dump(detail or {}),
                   error=error, attempt=attempt, cost_usd=token_cost(usage) if usage else 0.0,
                   tokens_in=int(usage.get("input_tokens", 0) or 0),
                   tokens_out=int(usage.get("output_tokens", 0) or 0))

    def step(self, node: str, state_in: dict, fn: Callable[[], Any],
             to_delta: Callable[[Any], dict], branch: Callable[[Any], str | None] | None = None):
        """Run fn now, with a running event before and an ok/error event after."""
        started = utcnow()
        self.running(node, started)
        t0 = time.perf_counter()
        try:
            out = fn()
        except Exception as exc:
            self.close(node, "error", started, (time.perf_counter() - t0) * 1000,
                       state_in=state_in, error=f"{type(exc).__name__}: {exc}")
            raise
        self.close(node, "ok", started, (time.perf_counter() - t0) * 1000, state_in=state_in,
                   delta=to_delta(out), branch=branch(out) if branch else None)
        return out


# --------------------------------------------------------------------------
# the extract hook inside app.pipeline.process
# --------------------------------------------------------------------------

@dataclass
class _StartContext:
    tracer: _Tracer
    pdf_path: str
    source_name: str
    pace_s: float
    extract_started: datetime | None = None
    extract_ended: datetime | None = None
    raw_usage: dict = field(default_factory=dict)


_current: contextvars.ContextVar[_StartContext | None] = contextvars.ContextVar("v1_start", default=None)


def int_usage(usage: dict | None) -> dict[str, int]:
    out = {}
    for k, v in (usage or {}).items():
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        out[k] = int(round(v))
    return out


def _extract_hook(pdf_path, *args, **kwargs):
    ctx = _current.get()
    if ctx is None:  # someone else calling app.pipeline.process: untouched behaviour
        return _extract(pdf_path, *args, **kwargs)
    tracer = ctx.tracer
    ctx.extract_started = utcnow()
    tracer.running("extract", ctx.extract_started)
    state_in = {"pdf_path": ctx.pdf_path, "source_name": ctx.source_name, "replay_pace_s": ctx.pace_s}
    t0 = time.perf_counter()
    try:
        referral, usage = _extract(pdf_path, replay_pace_s=ctx.pace_s)
    except Exception as exc:
        tracer.close("extract", "error", ctx.extract_started, (time.perf_counter() - t0) * 1000,
                     state_in=state_in, error=f"{type(exc).__name__}: {exc}")
        raise
    ms = (time.perf_counter() - t0) * 1000
    ctx.extract_ended = utcnow()
    ctx.raw_usage = dict(usage or {})
    tracer.close("extract", "ok", ctx.extract_started, ms, state_in=state_in,
                 delta={"referral": referral_state(referral), "token_usage": ctx.raw_usage},
                 detail={"fields": len(referral.model_fields_set - {"confidence", "boxes"})},
                 usage=ctx.raw_usage)
    return referral, int_usage(usage)


if getattr(v1.extract, "__name__", "") != "_extract_hook":
    v1.extract = _extract_hook


# --------------------------------------------------------------------------
# shared stage functions (the same ones process() uses)
# --------------------------------------------------------------------------

def check_eligibility(referral: Referral):
    return parse_271(respond(build_270(referral, v1.CLINIC_NPI)))


def gate_status(reasons: list[str]) -> str:
    return "auto_approved" if not reasons else "needs_review"


class V1Runner:
    name = "v1"

    # ---------------------------------------------------------------- start
    def start(self, referral_id: str, pdf_path: str, source_name: str,
              replay_pace_s: float = 0.0) -> ReferralRecord:
        tracer = _Tracer(referral_id)
        ctx = _StartContext(tracer, str(pdf_path), source_name, max(0.0, float(replay_pace_s or 0.0)))
        token = _current.set(ctx)
        try:
            processed = v1.process(pdf_path, confidence_threshold=confidence_threshold())
        except Exception as exc:
            if ctx.extract_ended is not None:  # extract already closed its own error event otherwise
                tracer.close("process", "error", ctx.extract_ended, 0.0,
                             error=f"v1 pipeline failed after extract: {type(exc).__name__}: {exc}")
            raise
        finally:
            _current.reset(token)

        referral = processed.referral
        timings = dict(processed.stage_timings_ms)
        ref_state = referral_state(referral)

        # validate + eligibility ran inside process(); emit their events now, at their real offsets
        at = ctx.extract_ended or utcnow()
        for node, state_in, delta in (
            ("validate", {"referral": ref_state, "threshold": confidence_threshold()},
             {"flags": processed.flags}),
            ("eligibility", {"referral": ref_state}, {"eligibility": processed.eligibility}),
        ):
            ms = float(timings.get(node, 0.0))
            tracer.running(node, at)
            tracer.close(node, "ok", at, ms, state_in=state_in, delta=delta)
            at = at + timedelta(milliseconds=ms)
        tracer.running("auth", at)
        tracer.close("auth", "ok", at, 0.0, state_in={"referral": ref_state}, delta={"auth": processed.auth},
                     detail={"note": "computed inside app.pipeline.process (not timed there)"})

        reasons = self._gate(tracer, processed.flags, processed.eligibility, processed.auth,
                             v1_status=processed.status)
        status = gate_status(reasons)
        usage = int_usage(ctx.raw_usage or processed.token_usage)
        record = ReferralRecord(
            id=referral_id, pipeline=PIPELINE, source_name=source_name, source_file=str(pdf_path),
            status=status, referral=referral, flags=processed.flags, eligibility=processed.eligibility,
            auth=processed.auth, review_reasons=reasons,
            packet_available=bool(processed.auth and processed.auth.required),
            stage_timings_ms=timings, token_usage=usage, cost_usd=token_cost(usage),
        )
        if status == "auto_approved":
            return self._send(tracer, record)
        self._pause(tracer, record)
        return record

    # --------------------------------------------------------------- resume
    def resume(self, record: ReferralRecord, action: ReviewAction) -> ReferralRecord:
        tracer = _Tracer(record.id)
        if action.kind == "edit":
            return self._revalidate(tracer, record, action.referral or record.referral)
        if action.kind == "approve":
            return self._send(tracer, record.model_copy(update={"status": "approved"}))
        if action.kind == "retry_send":
            return self._send(tracer, record, reuse_message=True)
        if action.kind == "reject":
            started = utcnow()
            tracer.running("reject", started)
            tracer.close("reject", "ok", started, 0.0, state_in={"status": record.status},
                         delta={"status": "rejected", "reason": action.note})
            return record.model_copy(update={"status": "rejected", "error": None})
        raise ValueError(f"unknown review action {action.kind!r}")

    # -------------------------------------------------------------- helpers
    def _gate(self, tracer: _Tracer, flags, eligibility, auth, v1_status: str | None = None,
              force_review: bool = False) -> list[str]:
        state_in = {"flags": flags, "eligibility": eligibility, "auth": auth}

        def decide():
            reasons = review_reasons(flags, eligibility, auth)
            if v1_status is not None and gate_status(reasons) != v1_status:
                log.warning("gate disagrees with app.pipeline.process: %s vs %s", reasons, v1_status)
            return reasons

        def branch(reasons):
            return "human_review" if (reasons or force_review) else "order"

        return tracer.step("gate", state_in, decide,
                           lambda r: {"review_reasons": r,
                                      "status": "needs_review" if (r or force_review) else "auto_approved"},
                           branch)

    def _pause(self, tracer: _Tracer, record: ReferralRecord) -> None:
        started = utcnow()
        tracer.running("human_review", started)
        tracer.close("human_review", "interrupted", started, 0.0,
                     state_in={"status": record.status, "review_reasons": record.review_reasons},
                     delta={"status": "needs_review"},
                     detail={"waiting_for": "approve / edit / reject"})

    def _revalidate(self, tracer: _Tracer, record: ReferralRecord, referral: Referral) -> ReferralRecord:
        threshold = confidence_threshold()
        ref_state = referral_state(referral)
        flags = tracer.step("validate", {"referral": ref_state, "threshold": threshold},
                            lambda: validate(referral, threshold), lambda f: {"flags": f})
        eligibility = tracer.step("eligibility", {"referral": ref_state},
                                  lambda: check_eligibility(referral), lambda e: {"eligibility": e})
        auth = tracer.step("auth", {"referral": ref_state},
                           lambda: auth_requirement(referral), lambda a: {"auth": a})
        reasons = self._gate(tracer, flags, eligibility, auth, force_review=True)
        updated = record.model_copy(update={
            "status": "needs_review", "referral": referral, "flags": flags, "eligibility": eligibility,
            "auth": auth, "review_reasons": reasons, "packet_available": bool(auth and auth.required),
            # citations were computed for the old values; /policy recomputes when this is empty
            "citations": [], "keywords": [],
        })
        self._pause(tracer, updated)
        return updated

    def _send(self, tracer: _Tracer, record: ReferralRecord, reuse_message: bool = False) -> ReferralRecord:
        """Build (or reuse) the ORM, send it over MLLP and record the outcome. Never raises:
        every RIS problem ends as status ris_error with order.last_error set."""
        attempt = record.order.attempts + 1
        rid = record.id.upper()
        order_id = record.order.order_id or "ORD" + rid
        message_id = f"MSG{rid}-{attempt}"
        started = utcnow()
        tracer.running("order", started, attempt=attempt)
        t0 = time.perf_counter()

        message = None
        try:
            if reuse_message and record.order.message:
                message = hl7.with_message_id(record.order.message, message_id)
            else:
                message = hl7.build_orm(record.referral, order_id, "MRN" + rid, message_id)
            result = hl7.send_order(message)
            code, raw, error = result.code, result.raw, result.error
            where = {"host": result.host, "port": result.port}
        except Exception as exc:  # e.g. an ORM that cannot be built
            code, raw, error = None, None, f"could not send order: {type(exc).__name__}: {exc}"
            where = {}
        ms = (time.perf_counter() - t0) * 1000

        order = OrderInfo(order_id=order_id, message=message, ack_code=code, ack_raw=raw,
                          attempts=attempt, last_error=error, sent_at=utcnow())
        status = "sent_to_ris" if code == "AA" else "ris_error"
        tracer.close("order", "ok" if status == "sent_to_ris" else "error", started, ms, attempt=attempt,
                     state_in={"referral": referral_state(record.referral), "status": record.status,
                               "order": record.order},
                     delta={"order": order, "status": status},
                     detail={"message_id": message_id, "ack_code": code, **where},
                     error=error)
        timings = dict(record.stage_timings_ms)
        timings["order"] = ms
        return record.model_copy(update={"order": order, "status": status, "error": error,
                                         "stage_timings_ms": timings})
