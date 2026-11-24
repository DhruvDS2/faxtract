"""Persistence for referral records, reviewer corrections and RIS send attempts.

Tables live on app.db.Base (app.db.init_db() imports this module). The API is
the only writer of `referrals` and `corrections`; pipeline runners never touch
them (docs/CONTRACTS.md §6). Every function returns the frozen shapes:
ReferralRecord, ReferralSummary, RisOrderRow (app.contracts) and Correction
(app.models).

    referrals    one row per referral: the full ReferralRecord as JSON, plus
                 indexed status / payor / created_at for the queue filters
    corrections  one row per changed field per PATCH (the reviewer feedback loop)
    ris_sends    one row per MLLP send attempt (audit log behind /orders)
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Integer, String, Text, func, select
from sqlalchemy.dialects.postgresql import JSONB, insert

from app.contracts import RETRYABLE, ReferralRecord, ReferralSummary, RisOrderRow
from app.db import Base, SessionLocal
from app.models import Correction


class ReferralRow(Base):
    __tablename__ = "referrals"

    id = Column(String(16), primary_key=True)
    pipeline = Column(String(16), nullable=False)
    status = Column(String(32), nullable=False, index=True)
    payor = Column(Text, index=True)
    source_name = Column(Text, nullable=False)
    send_attempts = Column(Integer, nullable=False, default=0, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), nullable=False)
    record = Column(JSONB, nullable=False)


class CorrectionRow(Base):
    __tablename__ = "corrections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    referral_id = Column(String(16), nullable=False, index=True)
    field = Column(String(64), nullable=False)
    original_value = Column(Text)
    corrected_value = Column(Text)
    original_confidence = Column(Float)
    corrected_at = Column(DateTime(timezone=True), nullable=False)


class RisSendRow(Base):
    __tablename__ = "ris_sends"

    id = Column(Integer, primary_key=True, autoincrement=True)
    referral_id = Column(String(16), nullable=False, index=True)
    order_id = Column(String(32))
    attempt = Column(Integer, nullable=False)
    ack_code = Column(String(2))
    error = Column(Text)
    sent_at = Column(DateTime(timezone=True), nullable=False)


def _aware(dt: datetime | None) -> datetime | None:
    """Store every timestamp as UTC; a naive one is taken to be UTC already."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


# --------------------------------------------------------------------------
# referrals
# --------------------------------------------------------------------------

def _row_values(record: ReferralRecord) -> dict:
    return {
        "id": record.id,
        "pipeline": record.pipeline,
        "status": record.status,
        "payor": record.referral.payor_name,
        "source_name": record.source_name,
        "send_attempts": record.order.attempts,
        "created_at": _aware(record.created_at),
        "updated_at": _aware(record.updated_at),
        "record": record.model_dump(mode="json"),
    }


def save_referral(record: ReferralRecord, corrections: list[Correction] = ()) -> ReferralRecord:
    """Insert or replace the record (and add any corrections) in one transaction."""
    values = _row_values(record)
    stmt = insert(ReferralRow).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[ReferralRow.id],
        set_={k: stmt.excluded[k] for k in values if k not in ("id", "created_at")},
    )
    with SessionLocal() as session:
        session.execute(stmt)
        for c in corrections:
            session.add(_correction_row(c))
        session.commit()
    return record


def get_referral(referral_id: str) -> ReferralRecord | None:
    with SessionLocal() as session:
        row = session.get(ReferralRow, referral_id)
        return ReferralRecord.model_validate(row.record) if row else None


def exists(referral_id: str) -> bool:
    with SessionLocal() as session:
        return session.get(ReferralRow, referral_id) is not None


def _filtered(status: str | list[str] | None = None, payor: str | None = None,
              sent_only: bool = False):
    query = select(ReferralRow.record)
    if status:
        wanted = [s.strip() for s in (status.split(",") if isinstance(status, str) else status) if s.strip()]
        if wanted:
            query = query.where(ReferralRow.status.in_(wanted))
    if payor and payor.strip():
        query = query.where(func.lower(ReferralRow.payor) == payor.strip().lower())
    if sent_only:
        query = query.where(ReferralRow.send_attempts > 0)
    return query


def list_records(status: str | list[str] | None = None, payor: str | None = None,
                 sent_only: bool = False) -> list[ReferralRecord]:
    with SessionLocal() as session:
        rows = session.execute(_filtered(status, payor, sent_only)).scalars().all()
    return [ReferralRecord.model_validate(r) for r in rows]


def summarize(record: ReferralRecord) -> ReferralSummary:
    r = record.referral
    last, first = r.patient_last_name, r.patient_first_name
    name = ", ".join(p for p in (last, first) if p) or None
    conf = list(r.confidence.values())
    return ReferralSummary(
        id=record.id,
        pipeline=record.pipeline,
        source_name=record.source_name,
        status=record.status,
        patient_name=name,
        patient_dob=r.patient_dob.isoformat() if r.patient_dob else None,
        cpt_code=r.cpt_code,
        requested_study=r.requested_study,
        payor_name=r.payor_name,
        member_id=r.member_id,
        min_confidence=min(conf) if conf else None,
        error_count=sum(1 for f in record.flags if f.severity == "error"),
        warning_count=sum(1 for f in record.flags if f.severity == "warning"),
        ack_code=record.order.ack_code,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def list_summaries(status: str | None = None, payor: str | None = None) -> list[ReferralSummary]:
    return [summarize(r) for r in list_records(status, payor)]


def mark_interrupted_processing(reason: str) -> int:
    """At API start: a record still `processing` belongs to a run that died with
    the previous process. Mark it failed so it does not spin forever."""
    stuck = list_records(status="processing")
    now = datetime.now(timezone.utc)
    for rec in stuck:
        save_referral(rec.model_copy(update={"status": "failed", "error": reason, "updated_at": now}))
    return len(stuck)


# --------------------------------------------------------------------------
# corrections
# --------------------------------------------------------------------------

def _correction_row(c: Correction) -> CorrectionRow:
    return CorrectionRow(
        referral_id=c.referral_id,
        field=c.field,
        original_value=c.original_value,
        corrected_value=c.corrected_value,
        original_confidence=c.original_confidence,
        corrected_at=_aware(c.corrected_at),
    )


def add_corrections(corrections: list[Correction]) -> None:
    with SessionLocal() as session:
        for c in corrections:
            session.add(_correction_row(c))
        session.commit()


def list_corrections(referral_id: str | None = None) -> list[Correction]:
    query = select(CorrectionRow).order_by(CorrectionRow.corrected_at, CorrectionRow.id)
    if referral_id is not None:
        query = query.where(CorrectionRow.referral_id == referral_id)
    with SessionLocal() as session:
        rows = session.execute(query).scalars().all()
        return [Correction(referral_id=r.referral_id, field=r.field, original_value=r.original_value,
                           corrected_value=r.corrected_value, original_confidence=r.original_confidence,
                           corrected_at=r.corrected_at) for r in rows]


# --------------------------------------------------------------------------
# RIS sends
# --------------------------------------------------------------------------

def log_send(record: ReferralRecord) -> None:
    """Append the record's latest send attempt to the audit log."""
    order = record.order
    with SessionLocal() as session:
        session.add(RisSendRow(
            referral_id=record.id, order_id=order.order_id, attempt=order.attempts,
            ack_code=order.ack_code, error=order.last_error,
            sent_at=_aware(order.sent_at) or datetime.now(timezone.utc),
        ))
        session.commit()


def list_sends(referral_id: str) -> list[dict]:
    with SessionLocal() as session:
        rows = session.execute(
            select(RisSendRow).where(RisSendRow.referral_id == referral_id).order_by(RisSendRow.id)
        ).scalars().all()
        return [{"order_id": r.order_id, "attempt": r.attempt, "ack_code": r.ack_code,
                 "error": r.error, "sent_at": r.sent_at} for r in rows]


def order_rows(ris_order_ids: set[str]) -> list[RisOrderRow]:
    """Every referral with at least one send attempt, checked against the RIS store."""
    out = []
    for rec in list_records(sent_only=True):
        r, order = rec.referral, rec.order
        name = ", ".join(p for p in (r.patient_last_name, r.patient_first_name) if p) or None
        out.append(RisOrderRow(
            referral_id=rec.id, order_id=order.order_id, patient_name=name, cpt_code=r.cpt_code,
            status=rec.status, ack_code=order.ack_code, attempts=order.attempts,
            last_error=order.last_error, sent_at=order.sent_at,
            in_ris=bool(order.order_id and order.order_id in ris_order_ids),
            retryable=rec.status in RETRYABLE,
        ))
    return out
