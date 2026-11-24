"""app/runner_v1.py: the shared gate agrees with app.pipeline.process on every
corpus fax, and the v1 runner leaves app.pipeline's behaviour untouched."""
import logging
from pathlib import Path

import pytest

import app.pipeline as v1
from app import trace
from app.runner_v1 import V1Runner, int_usage


def test_gate_agrees_with_v1_process_on_all_60(corpus, ris_server, monkeypatch, caplog):
    monkeypatch.setenv("EXTRACTOR", "replay")
    events = []
    monkeypatch.setattr(trace, "emit", lambda e: events.append(e) or e)
    runner = V1Runner()
    outcomes = {}
    with caplog.at_level(logging.WARNING, logger="faxtract.v1"):
        for pdf in sorted(Path(corpus).glob("referral_*.pdf")):
            rec = runner.start(pdf.stem[-3:] + "00000", str(pdf), pdf.name)
            outcomes[pdf.name] = rec.status
            if rec.review_reasons:
                assert rec.status == "needs_review"
            else:
                assert rec.status == "sent_to_ris" and rec.order.ack_code == "AA"
    assert len(outcomes) == 60
    assert not [r for r in caplog.records if "gate disagrees" in r.getMessage()]
    assert {"needs_review", "sent_to_ris"} == set(outcomes.values())
    assert all(isinstance(v, int) for v in rec.token_usage.values())
    assert {e.node for e in events} >= {"extract", "validate", "eligibility", "auth", "gate", "human_review", "order"}


def test_hook_is_transparent_outside_the_runner(corpus, monkeypatch):
    monkeypatch.setenv("EXTRACTOR", "fixture")
    processed = v1.process(Path(corpus) / "referral_013.pdf")  # no runner context: plain v1
    assert processed.referral.patient_last_name == "Halloran"


def test_int_usage():
    assert int_usage({"input_tokens": 10, "replayed_latency_ms": 9682.9, "x": None, "ok": True}) == {
        "input_tokens": 10, "replayed_latency_ms": 9683}


def test_unknown_action_raises():
    from app.contracts import ReferralRecord, ReviewAction
    from app.models import Referral
    rec = ReferralRecord(id="x", pipeline="v1", source_name="a.pdf", source_file="a.pdf", status="needs_review",
                         referral=Referral())
    with pytest.raises(Exception):
        V1Runner().resume(rec, ReviewAction.model_construct(kind="explode"))
