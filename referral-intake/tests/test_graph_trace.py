"""Trace events the served graph writes (docs/CONTRACTS.md section 6)."""
import json
import os
import uuid

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import pytest

from app import trace
from app.contracts import ReviewAction, token_cost
from graph import pipeline as graph_pipeline
from graph import service


@pytest.fixture
def run_013(db, corpus, ris_server, tmp_path, monkeypatch):
    """referral_013 run to its pause, then approved: two runs, both traced."""
    monkeypatch.setenv("EXTRACTOR", "replay")
    monkeypatch.setattr(graph_pipeline, "PACKETS", tmp_path / "packets")
    service.reset()
    runner = service.GraphRunner()
    paused = runner.start(uuid.uuid4().hex[:8], str(corpus / "referral_013.pdf"), "referral_013.pdf")
    done = runner.resume(paused, ReviewAction(kind="approve"))
    yield paused, done, trace.list_for(done.id)
    service.reset()


def test_every_node_run_is_a_running_plus_closing_pair(run_013):
    _, _, events = run_013
    assert [e.seq for e in events] == list(range(1, len(events) + 1))
    assert len(events) % 2 == 0
    for opening, closing in zip(events[::2], events[1::2]):
        assert opening.status == "running"
        assert (opening.duration_ms, opening.state_in, opening.delta) == (0.0, None, None)
        assert closing.status in ("ok", "error", "interrupted")
        assert (closing.node, closing.run_id, closing.attempt) == (opening.node, opening.run_id, opening.attempt)
        assert closing.duration_ms >= 0
        assert closing.pipeline == "graph"


def test_each_call_is_its_own_run_and_the_pause_reads_right(run_013):
    paused, _, events = run_013
    runs = list(dict.fromkeys(e.run_id for e in events))
    assert len(runs) == 2, "one run_id per start() and per resume()"

    first = [(e.node, e.status, e.branch) for e in events if e.run_id == runs[0] and e.status != "running"]
    assert first == [("extract", "ok", "validate"), ("validate", "ok", "eligibility"),
                     ("eligibility", "ok", "auth"), ("auth", "ok", "retrieve"), ("retrieve", "ok", "packet"),
                     ("packet", "ok", "human_review"), ("human_review", "interrupted", None)]
    second = [(e.node, e.status, e.branch) for e in events if e.run_id == runs[1] and e.status != "running"]
    assert second == [("human_review", "ok", "order"), ("order", "ok", "__end__")]


def test_closing_events_carry_state_without_boxes(run_013):
    paused, _, events = run_013
    closings = [e for e in events if e.status != "running"]
    for e in closings:
        assert isinstance(e.state_in, dict)
        json.dumps(e.state_in), json.dumps(e.delta)
        if e.state_in.get("referral"):
            assert "boxes" not in e.state_in["referral"]
        assert "node_runs" not in e.state_in
    extract = closings[0]
    assert extract.node == "extract"
    assert extract.state_in["referral"] is None and extract.state_in["source_name"] == "referral_013.pdf"
    assert extract.delta["referral"]["patient_first_name"] == "Ciara"
    assert "boxes" not in extract.delta["referral"]
    assert paused.referral.boxes, "the record itself keeps the boxes"

    interrupted = [e for e in closings if e.status == "interrupted"][0]
    assert interrupted.delta is None
    assert interrupted.detail["waiting_for"]["review_reasons"] == paused.review_reasons

    order = [e for e in closings if e.node == "order"][0]
    assert order.delta["order"]["ack_code"] == "AA" and order.delta["status"] == "sent_to_ris"


def test_extract_event_carries_tokens_and_cost(run_013):
    paused, _, events = run_013
    extract = [e for e in events if e.node == "extract" and e.status == "ok"][0]
    assert extract.tokens_in == paused.token_usage["input_tokens"] > 0
    assert extract.tokens_out == paused.token_usage["output_tokens"] > 0
    assert extract.cost_usd == pytest.approx(token_cost(paused.token_usage)) == pytest.approx(paused.cost_usd)
    assert extract.detail["engine"] == "replay"
    others = [e for e in events if e.node != "extract"]
    assert all(e.cost_usd == 0 and e.tokens_in == 0 for e in others)
