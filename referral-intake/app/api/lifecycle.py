"""The referral lifecycle as the API enforces it (docs/CONTRACTS.md §4).

The API owns status checks (409s), PATCH coercion, the ReviewEvent log, the
corrections log and persistence. Runners compute; this module persists.
"""
from __future__ import annotations

import logging
import os
import re
import time
import uuid
from pathlib import Path

from app import store
from app.api.errors import ApiError, not_found
from app.api.state import ApiState, packet_path, uploads_dir
from app.coerce import PatchError, apply_patch, corrections_for
from app.contracts import (REJECTABLE, RETRYABLE, REVIEWABLE, ReferralRecord, ReviewAction,
                           ReviewEvent, utcnow)
from app.gate import blocking_flags
from app.models import Referral

log = logging.getLogger("faxtract.api")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_NAME_STEM = 100
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")
SENDING = ("approved", "auto_approved")  # transient: never at rest


# --------------------------------------------------------------------------
# upload
# --------------------------------------------------------------------------

def sanitize_filename(name: str | None) -> str:
    """Basename only, [A-Za-z0-9._-], capped, always .pdf. '../../x.pdf' -> 'x.pdf'.
    The corpus engines match referral_NNN in it, so a normal name survives intact."""
    base = (name or "").replace("\\", "/").split("/")[-1]
    base = _UNSAFE.sub("_", base).lstrip(".")
    stem = base[:-4] if base.lower().endswith(".pdf") else base
    stem = stem.strip("._-")[:MAX_NAME_STEM].rstrip("._-") or "upload"
    return stem + ".pdf"


def default_pace() -> float:
    raw = os.getenv("REPLAY_PACE_S", "").strip()
    try:
        return max(0.0, float(raw)) if raw else 0.0
    except ValueError:
        log.warning("REPLAY_PACE_S=%r is not a number; using 0", raw)
        return 0.0


def new_referral_id() -> str:
    for _ in range(10):
        rid = uuid.uuid4().hex[:8]
        if not store.exists(rid):
            return rid
    raise RuntimeError("could not allocate a free referral id")


def create_upload(state: ApiState, data: bytes, filename: str | None) -> ReferralRecord:
    if not data.startswith(b"%PDF"):
        raise ApiError(400, "not a PDF: the file does not start with %PDF")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(400, f"file too large ({len(data)} bytes; limit {MAX_UPLOAD_BYTES})")
    rid = new_referral_id()
    name = sanitize_filename(filename)
    base = uploads_dir().resolve()
    folder = (base / rid).resolve()
    dest = (folder / name).resolve()
    if not dest.is_relative_to(base):  # belt and braces; sanitize_filename already guarantees it
        raise ApiError(400, "invalid file name")
    folder.mkdir(parents=True, exist_ok=False)
    dest.write_bytes(data)
    record = ReferralRecord(id=rid, pipeline=state.pipeline, source_name=name, source_file=str(dest),
                            status="processing", referral=Referral())
    return store.save_referral(record)


def run_start(state: ApiState, record: ReferralRecord, pace_s: float) -> ReferralRecord:
    """Run the pipeline for a fresh upload and persist the outcome. Never raises:
    a crash becomes status failed with error set."""
    try:
        result = state.runner(record.pipeline).start(record.id, record.source_file, record.source_name, pace_s)
        settled = _settle(record, result, None)
    except Exception as exc:
        log.exception("pipeline failed for %s", record.id)
        settled = record.model_copy(update={"status": "failed", "error": f"{type(exc).__name__}: {exc}",
                                            "updated_at": utcnow()})
    with state.lock(record.id):
        store.save_referral(settled)
        if settled.order.attempts > record.order.attempts:
            _log_send(settled)
    return settled


# --------------------------------------------------------------------------
# review actions
# --------------------------------------------------------------------------

def _settle(before: ReferralRecord, after: ReferralRecord, event: ReviewEvent | None) -> ReferralRecord:
    """Carry the API-owned fields over from the stored record, append the review
    event, stamp updated_at, and enforce 'a send never rests in approved'."""
    update = {
        "id": before.id, "pipeline": before.pipeline, "source_name": before.source_name,
        "source_file": before.source_file, "created_at": before.created_at,
        "reviews": [*before.reviews, *([event] if event else [])], "updated_at": utcnow(),
    }
    if after.status in SENDING:
        reason = after.order.last_error or "the order send did not complete"
        update |= {"status": "ris_error", "error": reason,
                   "order": after.order.model_copy(update={"last_error": reason})}
    return after.model_copy(update=update)


def _log_send(record: ReferralRecord) -> None:
    try:
        store.log_send(record)
    except Exception:
        log.exception("could not log the RIS send for %s", record.id)


def load(referral_id: str) -> ReferralRecord:
    record = store.get_referral(referral_id)
    if record is None:
        raise not_found(f"referral {referral_id}")
    return record


def _require(record: ReferralRecord, allowed: tuple[str, ...], verb: str) -> None:
    if record.status not in allowed:
        raise ApiError(409, f"cannot {verb} a referral that is {record.status}; "
                            f"allowed only when {' or '.join(allowed)}", status=record.status)


def _resume(state: ApiState, record: ReferralRecord, action: ReviewAction) -> ReferralRecord:
    try:
        return state.runner(record.pipeline).resume(record, action)
    except NotImplementedError as exc:
        raise ApiError(501, f"the {record.pipeline} pipeline cannot {action.kind} yet: {exc}",
                       status=record.status) from None
    except Exception as exc:
        log.exception("%s failed for %s", action.kind, record.id)
        raise ApiError(500, f"{action.kind} failed inside the {record.pipeline} pipeline: "
                            f"{type(exc).__name__}: {exc}", status=record.status) from None


def _finish(record: ReferralRecord, result: ReferralRecord, event: ReviewEvent,
            corrections=()) -> ReferralRecord:
    settled = _settle(record, result, event)
    store.save_referral(settled, list(corrections))
    if settled.order.attempts > record.order.attempts:
        _log_send(settled)
    return settled


def edit(state: ApiState, referral_id: str, fields: dict, reviewer: str | None) -> ReferralRecord:
    with state.lock(referral_id):
        record = load(referral_id)
        _require(record, REVIEWABLE, "edit")
        try:
            corrected, changed = apply_patch(record.referral, fields)
        except PatchError as exc:
            raise ApiError(422, "some fields could not be applied: " + str(exc), errors=exc.errors,
                           status=record.status) from None
        if not changed:
            return record
        started = time.time()
        result = _resume(state, record, ReviewAction(kind="edit", reviewer=reviewer, referral=corrected,
                                                     changed_fields=changed))
        _drop_stale_packet(referral_id, started)
        event = ReviewEvent(action="edit", reviewer=reviewer, fields=changed)
        return _finish(record, result, event, corrections_for(referral_id, record.referral, corrected, changed))


def approve(state: ApiState, referral_id: str, reviewer: str | None, note: str | None) -> ReferralRecord:
    with state.lock(referral_id):
        record = load(referral_id)
        _require(record, REVIEWABLE, "approve")
        blocking = blocking_flags(record.flags)
        if blocking:
            raise ApiError(409, f"{len(blocking)} error flag(s) must be fixed before approval: "
                                + "; ".join(f"{f.field}: {f.message}" for f in blocking),
                           status=record.status, flags=blocking)
        result = _resume(state, record, ReviewAction(kind="approve", reviewer=reviewer, note=note))
        return _finish(record, result, ReviewEvent(action="approve", reviewer=reviewer, note=note))


def reject(state: ApiState, referral_id: str, reason: str, reviewer: str | None) -> ReferralRecord:
    reason = (reason or "").strip()
    with state.lock(referral_id):
        record = load(referral_id)
        _require(record, REJECTABLE, "reject")
        if not reason:
            from app.contracts import FieldError
            raise ApiError(422, "reason is required", errors=[FieldError(field="reason", message="required")],
                           status=record.status)
        result = _resume(state, record, ReviewAction(kind="reject", reviewer=reviewer, note=reason))
        return _finish(record, result, ReviewEvent(action="reject", reviewer=reviewer, note=reason))


def retry_send(state: ApiState, referral_id: str) -> ReferralRecord:
    with state.lock(referral_id):
        record = load(referral_id)
        _require(record, RETRYABLE, "retry sending")
        result = _resume(state, record, ReviewAction(kind="retry_send"))
        return _finish(record, result, ReviewEvent(action="retry_send"))


def _drop_stale_packet(referral_id: str, edited_at: float) -> None:
    """An auth packet built before this edit describes the old values: remove it so
    GET /packet rebuilds it (a graph run that re-wrote it during the resume is kept)."""
    path: Path = packet_path(referral_id)
    try:
        if path.exists() and path.stat().st_mtime < edited_at:
            path.unlink()
    except OSError:
        log.warning("could not remove stale packet %s", path)
