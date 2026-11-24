"""/referrals routes (docs/CONTRACTS.md §5)."""
from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, Query, Request, Response, UploadFile

from app import hl7, store, trace
from app.api import lifecycle
from app.api.errors import ApiError, not_found
from app.api.schemas import PolicyResult
from app.api.state import ApiState, get_state, packet_path
from app.contracts import (ApproveBody, OrderPreview, PolicyCitation, ReferralPatch, ReferralRecord,
                           ReferralSummary, RejectBody, RetrievalCompare, TraceEvent)
from app.models import Correction

log = logging.getLogger("faxtract.api")
router = APIRouter()

POLICY_K = 6


# --------------------------------------------------------------------------
# upload + read
# --------------------------------------------------------------------------

@router.post("/referrals", response_model=ReferralRecord, status_code=202)
def upload(response: Response, file: UploadFile = File(...), pace_s: float | None = Form(None),
           wait: bool = Query(False), state: ApiState = Depends(get_state)):
    data = file.file.read(lifecycle.MAX_UPLOAD_BYTES + 1)
    record = lifecycle.create_upload(state, data, file.filename)
    pace = lifecycle.default_pace() if pace_s is None else max(0.0, pace_s)
    if wait:
        response.status_code = 201
        return lifecycle.run_start(state, record, pace)
    state.executor.submit(lifecycle.run_start, state, record, pace)
    return record


@router.get("/referrals", response_model=list[ReferralSummary])
def list_referrals(status: str | None = None, payor: str | None = None):
    return store.list_summaries(status=status, payor=payor)


@router.get("/referrals/{referral_id}", response_model=ReferralRecord)
def get_referral(referral_id: str):
    return lifecycle.load(referral_id)


def _stored_pdf(record: ReferralRecord) -> Path:
    path = Path(record.source_file)
    if not path.is_file():
        raise not_found(f"the stored PDF for referral {record.id}")
    return path


def _pdf_bytes(path: Path) -> tuple[bytes, str]:
    try:
        from app import pages  # Lane B's page/PDF cache (CONTRACTS §15)
        return pages.pdf_bytes(path)
    except ImportError:
        data = path.read_bytes()
        return data, '"' + hashlib.sha256(data).hexdigest()[:32] + '"'


@router.get("/referrals/{referral_id}/fax.pdf")
def fax_pdf(referral_id: str, request: Request):
    record = lifecycle.load(referral_id)
    data, etag = _pdf_bytes(_stored_pdf(record))
    headers = {"ETag": etag, "Cache-Control": "private, max-age=3600"}
    if etag in [t.strip() for t in request.headers.get("if-none-match", "").split(",")]:
        return Response(status_code=304, headers=headers)
    headers["Content-Disposition"] = f'inline; filename="{record.source_name}"'
    return Response(content=data, media_type="application/pdf", headers=headers)


@router.get("/referrals/{referral_id}/pages/{n}.png")
def page_png(referral_id: str, n: int):
    """Page n (0-based, like Box.page) as PNG, from Lane B's app/pages.py cache."""
    record = lifecycle.load(referral_id)
    path = _stored_pdf(record)
    try:
        from app import pages
    except ImportError:
        raise ApiError(501, "page rendering is not available (app/pages.py is not installed)") from None
    count = pages.page_count(path)
    if n < 0 or n >= count:
        raise not_found(f"page {n} (this fax has {count} page(s), numbered from 0)")
    return Response(content=pages.page_png(path, n), media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


# --------------------------------------------------------------------------
# review actions
# --------------------------------------------------------------------------

@router.patch("/referrals/{referral_id}", response_model=ReferralRecord)
def patch_referral(referral_id: str, body: ReferralPatch, state: ApiState = Depends(get_state)):
    return lifecycle.edit(state, referral_id, body.fields, body.reviewer)


@router.post("/referrals/{referral_id}/approve", response_model=ReferralRecord)
def approve(referral_id: str, body: ApproveBody | None = Body(None), state: ApiState = Depends(get_state)):
    body = body or ApproveBody()
    return lifecycle.approve(state, referral_id, body.reviewer, body.note)


@router.post("/referrals/{referral_id}/reject", response_model=ReferralRecord)
def reject(referral_id: str, body: RejectBody, state: ApiState = Depends(get_state)):
    return lifecycle.reject(state, referral_id, body.reason, body.reviewer)


@router.post("/referrals/{referral_id}/retry-send", response_model=ReferralRecord)
def retry_send(referral_id: str, state: ApiState = Depends(get_state)):
    return lifecycle.retry_send(state, referral_id)


# --------------------------------------------------------------------------
# evidence panels
# --------------------------------------------------------------------------

@router.get("/referrals/{referral_id}/trace", response_model=list[TraceEvent])
def get_trace(referral_id: str):
    lifecycle.load(referral_id)
    return trace.list_for(referral_id)


def _citations_for(record: ReferralRecord) -> tuple[list[str], list[PolicyCitation]]:
    """The pipeline's stored citations, else computed with the served v2 retriever."""
    if record.citations:
        return list(record.keywords), list(record.citations)
    r = record.referral
    if not r.payor_name:
        return [], []
    from app import rag  # lazy: loads the embedding model on first use
    indication = r.clinical_indication or r.requested_study or ""
    codes = [c for c in [r.cpt_code, *r.icd10_codes] if c]
    try:
        out = rag.retrieve_3step(indication, codes, r.payor_name, k=POLICY_K)
    except Exception as exc:
        log.exception("policy retrieval failed for %s", record.id)
        raise ApiError(503, f"policy retrieval is unavailable: {type(exc).__name__}: {exc}") from None
    citations = [PolicyCitation(source=Path(ch["source"]).stem, payor=ch.get("payor"), cpt=ch.get("cpt"),
                                score=round(float(score), 3), text=ch["text"])
                 for ch, score in out["results"]]
    return list(out["keywords"]), citations


def _auth_required(record: ReferralRecord) -> bool:
    return bool(record.auth and record.auth.required)


@router.get("/referrals/{referral_id}/policy", response_model=PolicyResult)
def get_policy(referral_id: str):
    record = lifecycle.load(referral_id)
    required = _auth_required(record)
    if not required and not record.citations:
        return PolicyResult(required=False, keywords=[], citations=[])
    keywords, citations = _citations_for(record)
    return PolicyResult(required=required, keywords=keywords, citations=citations)


@router.get("/referrals/{referral_id}/packet")
def get_packet(referral_id: str):
    record = lifecycle.load(referral_id)
    if not _auth_required(record):
        raise ApiError(409, "no prior authorization is required for this referral, so there is no packet",
                       status=record.status)
    path = packet_path(referral_id)
    if not path.is_file():
        _, citations = _citations_for(record)
        from app.auth_packet import build_packet
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=f".{referral_id}-", suffix=".pdf", dir=path.parent)
        os.close(fd)
        try:
            build_packet(record.referral, record.eligibility,
                         [{"path": c.source, "text": c.text} for c in citations], tmp)
            os.replace(tmp, path)
        finally:
            Path(tmp).unlink(missing_ok=True)
    return Response(content=path.read_bytes(), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="auth-packet-{referral_id}.pdf"',
                             "Cache-Control": "no-cache"})


@router.get("/referrals/{referral_id}/order", response_model=OrderPreview)
def get_order(referral_id: str):
    record = lifecycle.load(referral_id)
    if record.order.message:
        return OrderPreview(order_id=record.order.order_id or "ORD" + referral_id.upper(),
                            message=record.order.message, sent=True)
    rid = referral_id.upper()
    attempt = record.order.attempts + 1
    message = hl7.build_orm(record.referral, "ORD" + rid, "MRN" + rid, f"MSG{rid}-{attempt}")
    return OrderPreview(order_id="ORD" + rid, message=message, sent=False)


@router.get("/referrals/{referral_id}/retrieval-compare", response_model=RetrievalCompare)
def retrieval_compare(referral_id: str, k: int = Query(5, ge=1, le=20)):
    from app.retrieval_compare import CompareUnavailable, compare
    record = lifecycle.load(referral_id)
    try:
        return compare(record, k=k)
    except CompareUnavailable as exc:
        raise ApiError(409, str(exc), status=record.status) from None


@router.get("/referrals/{referral_id}/corrections", response_model=list[Correction])
def referral_corrections(referral_id: str):
    lifecycle.load(referral_id)
    return store.list_corrections(referral_id)
