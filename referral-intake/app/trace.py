"""Trace events: one row per pipeline node/stage execution, per referral.

Runners call emit(); the API serves list_for(). Shape: app.contracts.TraceEvent.
"""
from sqlalchemy import JSON, Column, DateTime, Float, Integer, String, Text, func, select

from app.contracts import TraceEvent
from app.db import Base, SessionLocal


class TraceEventRow(Base):
    __tablename__ = "trace_events"

    id = Column(Integer, primary_key=True)
    referral_id = Column(String(64), index=True, nullable=False)
    run_id = Column(String(64), nullable=False)
    seq = Column(Integer, nullable=False)
    pipeline = Column(String(16), nullable=False)
    node = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=False)
    duration_ms = Column(Float, nullable=False)
    cost_usd = Column(Float, nullable=False, default=0.0)
    tokens_in = Column(Integer, nullable=False, default=0)
    tokens_out = Column(Integer, nullable=False, default=0)
    attempt = Column(Integer, nullable=False, default=1)
    branch = Column(String(64))
    detail = Column(JSON, nullable=False, default=dict)
    error = Column(Text)
    state_in = Column(JSON)
    delta = Column(JSON)


_FIELDS = [c for c in TraceEvent.model_fields]


def emit(event: TraceEvent) -> TraceEvent:
    """Persist one event; assigns seq = next number for that referral."""
    with SessionLocal() as session:
        current = session.execute(
            select(func.max(TraceEventRow.seq)).where(TraceEventRow.referral_id == event.referral_id)
        ).scalar()
        event = event.model_copy(update={"seq": (current or 0) + 1})
        session.add(TraceEventRow(**event.model_dump(mode="json") | {"started_at": event.started_at}))
        session.commit()
    return event


def list_for(referral_id: str) -> list[TraceEvent]:
    with SessionLocal() as session:
        rows = session.execute(
            select(TraceEventRow).where(TraceEventRow.referral_id == referral_id).order_by(TraceEventRow.seq)
        ).scalars().all()
        return [TraceEvent(**{f: getattr(r, f) for f in _FIELDS}) for r in rows]
