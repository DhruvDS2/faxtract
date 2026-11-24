"""Review lifecycle through the HTTP API with PIPELINE=v1 and the replay extractor
(real recorded Claude output for the corpus faxes): PATCH coercion, approve/reject/
retry-send rules, RIS failures, corrections persistence, trace events."""
import json
import os
import time

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import pytest
from fastapi.testclient import TestClient

from app import db as appdb
from app.contracts import ReferralRecord

# referral_013: needs_review (eligibility not found, prior auth missing prior_imaging), no error
# flags; the replayed extraction reads "Ciara" for the printed "Clara". Last name Halloran.
REVIEW_FAX = "referral_013.pdf"
# referral_002: passes the gate (auto-approved), no prior auth needed.
AUTO_FAX = "referral_002.pdf"


@pytest.fixture
def api(db, corpus, ris_server, monkeypatch, tmp_path):
    from app.api import state
    monkeypatch.setenv("PIPELINE", "v1")
    monkeypatch.setenv("EXTRACTOR", "replay")
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setattr(state, "PACKETS_DIR", tmp_path / "packets")
    for var in ("RIS_FAULT_LAST_NAMES", "REPLAY_PACE_S", "CONFIDENCE_THRESHOLD"):
        monkeypatch.delenv(var, raising=False)
    from app.main import create_app
    with TestClient(create_app()) as client:
        client.corpus = corpus
        client.ris = ris_server
        yield client


def upload(client, fax=REVIEW_FAX, name=None, wait=True):
    data = (client.corpus / fax).read_bytes()
    r = client.post("/referrals" + ("?wait=1" if wait else ""),
                    files={"file": (name or fax, data, "application/pdf")})
    assert r.status_code == (201 if wait else 202), r.text
    return r.json()


def ris_orders(client) -> dict:
    path = client.ris["store"]
    return json.loads(path.read_text()) if path.exists() else {}


def segments(message, seg_id):
    return [s.split("|") for s in message.split("\r") if s.startswith(seg_id + "|")]


def test_patch_dob_string_returns_date_and_orm_has_valid_dob(api):
    rec = upload(api)
    assert rec["status"] == "needs_review"
    r = api.patch(f"/referrals/{rec['id']}", json={"fields": {"patient_dob": "03/04/1961"}, "reviewer": "kim"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["referral"]["patient_dob"] == "1961-03-04"
    assert body["referral"]["confidence"]["patient_dob"] == 1.0
    assert body["status"] == "needs_review"
    assert body["reviews"][-1]["action"] == "edit" and body["reviews"][-1]["fields"] == ["patient_dob"]

    r = api.patch(f"/referrals/{rec['id']}", json={"fields": {"patient_dob": "1961-03-05"}})
    assert r.json()["referral"]["patient_dob"] == "1961-03-05"

    r = api.post(f"/referrals/{rec['id']}/approve", json={"reviewer": "kim"})
    assert r.status_code == 200, r.text
    approved = r.json()
    assert approved["status"] == "sent_to_ris" and approved["order"]["ack_code"] == "AA"
    pid = segments(approved["order"]["message"], "PID")[0]
    assert pid[7] == "19610305"
    assert ris_orders(api)[approved["order"]["order_id"]]["dob"] == "19610305"


def test_patch_icd_string_becomes_list_with_one_dg1_per_code(api):
    rec = upload(api)
    r = api.patch(f"/referrals/{rec['id']}", json={"fields": {"icd10_codes": " r19.00; R10.31 , k59.00"}})
    assert r.status_code == 200, r.text
    assert r.json()["referral"]["icd10_codes"] == ["R19.00", "R10.31", "K59.00"]

    preview = api.get(f"/referrals/{rec['id']}/order").json()
    assert preview["sent"] is False
    assert [s[3] for s in segments(preview["message"], "DG1")] == ["R19.00^^I10", "R10.31^^I10", "K59.00^^I10"]

    sent = api.post(f"/referrals/{rec['id']}/approve").json()
    assert sent["status"] == "sent_to_ris"
    assert len(segments(sent["order"]["message"], "DG1")) == 3
    stored = ris_orders(api)[sent["order"]["order_id"]]["raw"]
    assert stored.count("DG1|") == 3
    assert api.get(f"/referrals/{rec['id']}/order").json()["sent"] is True


def test_patch_rejects_unknown_frozen_and_unparseable_fields(api):
    rec = upload(api)
    rid = rec["id"]
    r = api.patch(f"/referrals/{rid}", json={"fields": {"favourite_colour": "teal"}})
    assert r.status_code == 422
    assert r.json()["errors"] == [{"field": "favourite_colour", "message": "unknown field"}]

    for frozen in ("confidence", "boxes"):
        r = api.patch(f"/referrals/{rid}", json={"fields": {frozen: {}}})
        assert r.status_code == 422 and r.json()["errors"][0]["field"] == frozen

    r = api.patch(f"/referrals/{rid}", json={"fields": {"patient_dob": "13/45/1961", "order_date": "soon",
                                                        "urgency": "whenever"}})
    assert r.status_code == 422
    fields = {e["field"] for e in r.json()["errors"]}
    assert {"patient_dob", "order_date"} <= fields
    body = r.json()
    assert set(body) == {"detail", "errors", "status", "flags"}

    r = api.patch(f"/referrals/{rid}", json={"fields": {"urgency": "whenever"}})
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "urgency"

    r = api.patch(f"/referrals/{rid}", json={"patient_dob": "1961-03-04"})  # missing the fields wrapper
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "fields"

    # nothing was applied by the failed patches
    after = api.get(f"/referrals/{rid}").json()
    assert after["referral"] == rec["referral"] and after["reviews"] == []
    assert api.get(f"/referrals/{rid}/corrections").json() == []

    assert api.patch("/referrals/nope0000", json={"fields": {"patient_sex": "F"}}).status_code == 404


def test_empty_string_means_null_and_blocking_flags_make_approve_409(api):
    rec = upload(api)
    r = api.patch(f"/referrals/{rec['id']}", json={"fields": {"patient_last_name": "  "}})
    assert r.status_code == 200
    body = r.json()
    assert body["referral"]["patient_last_name"] is None
    assert any(f["field"] == "patient_last_name" and f["severity"] == "error" for f in body["flags"])

    r = api.post(f"/referrals/{rec['id']}/approve")
    assert r.status_code == 409
    err = r.json()
    assert err["status"] == "needs_review"
    assert [f["field"] for f in err["flags"]] == ["patient_last_name"]
    assert api.get(f"/referrals/{rec['id']}").json()["status"] == "needs_review"
    assert ris_orders(api) == {}

    # fixing it re-validates and unblocks the approval
    api.patch(f"/referrals/{rec['id']}", json={"fields": {"patient_last_name": "Halloran"}})
    assert api.post(f"/referrals/{rec['id']}/approve").json()["status"] == "sent_to_ris"


def test_approve_with_ris_down_is_ris_error_then_retry_sends(api, ris_down, monkeypatch):
    rec = upload(api)
    monkeypatch.setenv("RIS_MLLP_PORT", str(ris_down["port"]))
    r = api.post(f"/referrals/{rec['id']}/approve", json={"note": "ok"})
    assert r.status_code == 200, r.text
    down = r.json()
    assert down["status"] == "ris_error"
    assert down["order"]["last_error"] == f"connection refused (127.0.0.1:{ris_down['port']})"
    assert down["error"] == down["order"]["last_error"]
    assert down["order"]["attempts"] == 1 and down["order"]["ack_code"] is None
    assert api.get(f"/referrals/{rec['id']}").json()["status"] == "ris_error"  # never resting in approved

    assert api.post(f"/referrals/{rec['id']}/approve").status_code == 409  # not needs_review any more
    orders = {o["referral_id"]: o for o in api.get("/orders").json()}
    assert orders[rec["id"]]["retryable"] is True and orders[rec["id"]]["in_ris"] is False

    monkeypatch.setenv("RIS_MLLP_PORT", str(api.ris["port"]))  # RIS is back
    r = api.post(f"/referrals/{rec['id']}/retry-send")
    assert r.status_code == 200, r.text
    sent = r.json()
    assert sent["status"] == "sent_to_ris" and sent["order"]["ack_code"] == "AA"
    assert sent["order"]["attempts"] == 2 and sent["order"]["last_error"] is None and sent["error"] is None
    assert segments(sent["order"]["message"], "MSH")[0][9] == f"MSG{rec['id'].upper()}-2"
    assert [e["action"] for e in sent["reviews"]] == ["approve", "retry_send"]
    row = {o["referral_id"]: o for o in api.get("/orders").json()}[rec["id"]]
    assert row["in_ris"] is True and row["retryable"] is False and row["attempts"] == 2

    assert api.post(f"/referrals/{rec['id']}/retry-send").status_code == 409  # only from ris_error


def test_ae_from_fault_last_names_is_ris_error(api, monkeypatch):
    rec = upload(api)
    monkeypatch.setenv("RIS_FAULT_LAST_NAMES", "Halloran")
    sent = api.post(f"/referrals/{rec['id']}/approve").json()
    assert sent["status"] == "ris_error"
    assert sent["order"]["ack_code"] == "AE"
    assert sent["order"]["last_error"] == "RIS answered AE: simulated RIS rejection"
    assert "MSA|AE|" in sent["order"]["ack_raw"]
    assert sent["order"]["order_id"] not in ris_orders(api)

    monkeypatch.delenv("RIS_FAULT_LAST_NAMES")
    retried = api.post(f"/referrals/{rec['id']}/retry-send").json()
    assert retried["status"] == "sent_to_ris" and retried["order"]["ack_code"] == "AA"


def test_reject_rules(api):
    rec = upload(api)
    rid = rec["id"]
    r = api.post(f"/referrals/{rid}/reject", json={})
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "reason"
    assert api.post(f"/referrals/{rid}/reject", json={"reason": "   "}).status_code == 422
    r = api.post(f"/referrals/{rid}/reject", json={"reason": "duplicate fax", "reviewer": "kim"})
    assert r.status_code == 200
    assert r.json()["status"] == "rejected" and r.json()["reviews"][-1]["note"] == "duplicate fax"
    for path, body in (("reject", {"reason": "again"}), ("approve", {}), ("retry-send", {})):
        r = api.post(f"/referrals/{rid}/{path}", json=body)
        assert r.status_code == 409 and r.json()["status"] == "rejected"
    assert api.patch(f"/referrals/{rid}", json={"fields": {"patient_sex": "F"}}).status_code == 409


def test_ris_error_can_be_rejected(api, ris_down, monkeypatch):
    rec = upload(api)
    monkeypatch.setenv("RIS_MLLP_PORT", str(ris_down["port"]))
    assert api.post(f"/referrals/{rec['id']}/approve").json()["status"] == "ris_error"
    assert api.post(f"/referrals/{rec['id']}/reject", json={"reason": "cancelled"}).json()["status"] == "rejected"


def test_auto_approved_referral_is_sent_on_upload(api):
    rec = upload(api, fax=AUTO_FAX)
    assert rec["status"] == "sent_to_ris"
    assert rec["review_reasons"] == []
    assert rec["order"]["ack_code"] == "AA" and rec["order"]["attempts"] == 1
    assert rec["order"]["order_id"] == "ORD" + rec["id"].upper()
    assert rec["order"]["order_id"] in ris_orders(api)
    rows = api.get("/orders").json()
    assert [(o["referral_id"], o["in_ris"], o["ack_code"]) for o in rows] == [(rec["id"], True, "AA")]
    # a reviewer cannot act on it any more
    assert api.post(f"/referrals/{rec['id']}/approve").status_code == 409


def test_corrections_persist_across_api_restart(api, db, monkeypatch):
    rec = upload(api)
    api.patch(f"/referrals/{rec['id']}", json={"fields": {"patient_first_name": "Clara"}, "reviewer": "kim"})
    api.patch(f"/referrals/{rec['id']}", json={"fields": {"icd10_codes": "R19.00 R10.31 K59.00"}})

    # a new engine and a new app against the same database
    appdb.reset_engine()
    from app.main import create_app
    with TestClient(create_app()) as fresh:
        corrections = fresh.get("/corrections").json()
        assert [(c["field"], c["original_value"], c["corrected_value"]) for c in corrections] == [
            ("patient_first_name", "Ciara", "Clara"),
            ("icd10_codes", "R19.00, R10.31", "R19.00, R10.31, K59.00"),
        ]
        assert corrections[0]["original_confidence"] == 0.95
        assert corrections[0]["referral_id"] == rec["id"]
        assert fresh.get(f"/referrals/{rec['id']}/corrections").json() == corrections
        stored = fresh.get(f"/referrals/{rec['id']}").json()
        assert stored["referral"]["patient_first_name"] == "Clara"
        assert stored["referral"]["confidence"]["patient_first_name"] == 1.0
        assert [e["action"] for e in stored["reviews"]] == ["edit", "edit"]


def test_unchanged_patch_is_a_no_op(api):
    rec = upload(api)
    r = api.patch(f"/referrals/{rec['id']}", json={"fields": {"patient_last_name": "Halloran"}})
    assert r.status_code == 200 and r.json()["reviews"] == []
    assert api.get(f"/referrals/{rec['id']}/corrections").json() == []


V1_START_NODES = ["extract", "validate", "eligibility", "auth", "gate", "human_review"]


def test_trace_api_returns_v1_stage_events(api):
    rec = upload(api)
    events = api.get(f"/referrals/{rec['id']}/trace").json()
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert len({e["run_id"] for e in events}) == 1
    nodes = [e["node"] for e in events if e["status"] != "running"]
    assert nodes == V1_START_NODES
    for node in V1_START_NODES:
        pair = [e for e in events if e["node"] == node]
        assert [e["status"] for e in pair][0] == "running"
        assert pair[0]["state_in"] is None and pair[0]["delta"] is None and pair[0]["duration_ms"] == 0
        assert pair[1]["status"] == ("interrupted" if node == "human_review" else "ok")
        assert pair[1]["pipeline"] == "v1"
    closing = {e["node"]: e for e in events if e["status"] != "running"}
    assert closing["extract"]["tokens_in"] == 1829 and closing["extract"]["cost_usd"] > 0
    assert closing["extract"]["delta"]["referral"]["patient_first_name"] == "Ciara"
    assert "boxes" not in closing["extract"]["delta"]["referral"]
    assert "boxes" not in closing["validate"]["state_in"]["referral"]
    assert closing["gate"]["branch"] == "human_review"
    assert closing["gate"]["delta"]["review_reasons"] == rec["review_reasons"]

    api.patch(f"/referrals/{rec['id']}", json={"fields": {"patient_first_name": "Clara"}})
    api.post(f"/referrals/{rec['id']}/approve")
    events = api.get(f"/referrals/{rec['id']}/trace").json()
    assert len({e["run_id"] for e in events}) == 3          # start, edit, approve
    order = [e for e in events if e["node"] == "order" and e["status"] != "running"]
    assert order[0]["status"] == "ok" and order[0]["detail"]["ack_code"] == "AA"
    edit_validate = [e for e in events if e["node"] == "validate" and e["status"] == "ok"][-1]
    assert edit_validate["state_in"]["referral"]["patient_first_name"] == "Clara"
    assert api.get("/referrals/nope0000/trace").status_code == 404


def test_background_upload_returns_202_then_settles(api):
    rec = upload(api, wait=False)
    assert rec["status"] == "processing" and rec["source_name"] == REVIEW_FAX
    deadline = time.time() + 30
    while time.time() < deadline:
        current = api.get(f"/referrals/{rec['id']}").json()
        if current["status"] != "processing":
            break
        time.sleep(0.1)
    assert current["status"] == "needs_review"
    assert current["created_at"] == rec["created_at"]
    ReferralRecord.model_validate(current)


def test_pipeline_crash_marks_failed(api):
    # a valid PDF the replay engine has no recording for
    data = (api.corpus / REVIEW_FAX).read_bytes()
    r = api.post("/referrals?wait=1", files={"file": ("new_fax.pdf", data, "application/pdf")})
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "failed" and "replay only knows the corpus faxes" in body["error"]
    events = api.get(f"/referrals/{body['id']}/trace").json()
    assert [e["status"] for e in events if e["node"] == "extract"] == ["running", "error"]


def test_list_filters(api):
    a = upload(api)
    b = upload(api, fax=AUTO_FAX)
    rows = api.get("/referrals").json()
    assert {r["id"] for r in rows} == {a["id"], b["id"]}
    assert [r["id"] for r in api.get("/referrals", params={"status": "needs_review"}).json()] == [a["id"]]
    assert [r["id"] for r in api.get("/referrals", params={"payor": "northgate plan"}).json()] == [a["id"]]
    assert api.get("/referrals", params={"status": "sent_to_ris", "payor": "Northgate Plan"}).json() == []
    row = next(r for r in rows if r["id"] == a["id"])
    assert row["patient_name"] == "Halloran, Ciara" and row["patient_dob"] == "1959-12-16"
    assert row["min_confidence"] == min(a["referral"]["confidence"].values())
    assert api.get("/referrals/nope0000").status_code == 404
