"""app/store.py: records, summaries, corrections and the send log in Postgres."""
from datetime import date, datetime, timedelta, timezone

from app import db as appdb
from app import store
from app.contracts import OrderInfo, ReferralRecord
from app.models import Correction, Flag, Referral


def _rec(rid="abcd0001", status="needs_review", payor="Northgate Plan", **kw):
    r = Referral(patient_first_name="Clara", patient_last_name="Halloran", patient_dob=date(1959, 12, 16),
                 payor_name=payor, cpt_code="74177", confidence={"a": 0.7, "b": 0.9})
    return ReferralRecord(id=rid, pipeline="v1", source_name="referral_013.pdf", source_file="/x/referral_013.pdf",
                          status=status, referral=r, **kw)


def test_save_get_roundtrip_and_upsert(db):
    rec = _rec(flags=[Flag(field="a", severity="error", message="m"), Flag(field="b", severity="warning", message="w")])
    store.save_referral(rec)
    assert store.get_referral("abcd0001") == rec
    assert store.get_referral("missing0") is None
    later = rec.model_copy(update={"status": "rejected", "updated_at": rec.updated_at + timedelta(seconds=5)})
    store.save_referral(later)
    got = store.get_referral("abcd0001")
    assert got.status == "rejected" and got.created_at == rec.created_at


def test_summaries_and_filters(db):
    store.save_referral(_rec("abcd0001", flags=[Flag(field="a", severity="error", message="m")]))
    store.save_referral(_rec("abcd0002", status="sent_to_ris", payor="Meridian Health"))
    s = {x.id: x for x in store.list_summaries()}
    assert s["abcd0001"].patient_name == "Halloran, Clara" and s["abcd0001"].patient_dob == "1959-12-16"
    assert s["abcd0001"].min_confidence == 0.7 and s["abcd0001"].error_count == 1
    assert [x.id for x in store.list_summaries(status="sent_to_ris")] == ["abcd0002"]
    assert [x.id for x in store.list_summaries(payor="NORTHGATE PLAN")] == ["abcd0001"]
    assert {x.id for x in store.list_summaries(status="needs_review,sent_to_ris")} == {"abcd0001", "abcd0002"}


def test_corrections_survive_a_new_engine(db):
    naive_utc = datetime(2026, 11, 23, 12, 0, 0)  # Correction's default is naive utcnow()
    store.add_corrections([Correction(referral_id="abcd0001", field="patient_first_name", original_value="Ciara",
                                      corrected_value="Clara", original_confidence=0.95, corrected_at=naive_utc)])
    appdb.reset_engine()
    got = store.list_corrections()
    assert [(c.field, c.original_value, c.corrected_value, c.original_confidence) for c in got] == [
        ("patient_first_name", "Ciara", "Clara", 0.95)]
    assert got[0].corrected_at == naive_utc.replace(tzinfo=timezone.utc)
    assert store.list_corrections("other000") == []


def test_order_rows_and_send_log(db):
    sent = _rec("abcd0003", status="sent_to_ris",
                order=OrderInfo(order_id="ORDABCD0003", ack_code="AA", attempts=1, sent_at=datetime.now(timezone.utc)))
    failed = _rec("abcd0004", status="ris_error",
                  order=OrderInfo(order_id="ORDABCD0004", attempts=2, last_error="connection refused (x:1)"))
    store.save_referral(sent)
    store.save_referral(failed)
    store.save_referral(_rec("abcd0005"))  # never sent: not an order row
    store.log_send(failed)
    rows = {r.referral_id: r for r in store.order_rows({"ORDABCD0003"})}
    assert set(rows) == {"abcd0003", "abcd0004"}
    assert rows["abcd0003"].in_ris and not rows["abcd0003"].retryable
    assert not rows["abcd0004"].in_ris and rows["abcd0004"].retryable and rows["abcd0004"].attempts == 2
    assert store.list_sends("abcd0004")[0]["error"] == "connection refused (x:1)"


def test_interrupted_processing_is_marked_failed(db):
    store.save_referral(_rec("abcd0006", status="processing"))
    assert store.mark_interrupted_processing("api restarted") == 1
    got = store.get_referral("abcd0006")
    assert got.status == "failed" and got.error == "api restarted"
