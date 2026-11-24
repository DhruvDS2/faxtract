"""The served graph end to end, through GraphRunner, on real Postgres and a real
MLLP RIS (conftest: db, ris_server, ris_down, corpus), with EXTRACTOR=replay so
the extraction is the committed real Claude run (no key, real model errors).
"""
import json
import os
import socketserver
import threading
import uuid

os.environ.setdefault("HF_HUB_OFFLINE", "1")  # the embedding model is cached locally

import pytest

from app import trace
from app.contracts import ReviewAction
from graph import pipeline as graph_pipeline
from graph import service


def new_id() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def graph_db(db, corpus, tmp_path, monkeypatch):
    """A fresh database for the checkpointer + trace, replay extraction, packets in tmp."""
    monkeypatch.setenv("EXTRACTOR", "replay")
    monkeypatch.setattr(graph_pipeline, "PACKETS", tmp_path / "packets")
    service.reset()
    service.setup()
    yield db
    service.reset()


@pytest.fixture
def indexed(graph_db):
    """Policy chunks embedded into this test database (embeddings computed once per session)."""
    from app import rag
    from app.db import SessionLocal
    from app.vectorstore import Chunk

    chunks, vectors = rag._index()
    with SessionLocal() as session:
        for c, vec in zip(chunks, vectors):
            session.add(Chunk(source=c["source"], payor=c["payor"], cpt=c["cpt"], text=c["text"], embedding=vec))
        session.commit()
    return len(chunks)


def start(runner, corpus, name, **kw):
    return runner.start(new_id(), str(corpus / f"{name}.pdf"), f"{name}.pdf", **kw)


def ris_orders(ris_server) -> dict:
    store = ris_server["store"]
    return json.loads(store.read_text()) if store.exists() else {}


def closing(events, node):
    return [e for e in events if e.node == node and e.status != "running"]


# --------------------------------------------------------------------------

def test_auto_approve_sends_order_and_gets_AA(graph_db, ris_server, corpus):
    record = start(service.GraphRunner(), corpus, "referral_002")

    assert record.status == "sent_to_ris"
    assert record.review_reasons == []
    assert record.order.ack_code == "AA" and record.order.attempts == 1
    assert record.order.order_id == "ORD" + record.id.upper()
    assert f"|MSG{record.id.upper()}-1|" in record.order.message
    assert record.order.last_error is None and record.error is None
    assert record.order.order_id in ris_orders(ris_server)

    events = trace.list_for(record.id)
    assert not [e for e in events if e.node == "human_review"]
    assert closing(events, "order")[-1].branch == "__end__"
    assert closing(events, "auth")[-1].detail["route"] == "auto"


def test_pause_then_approve_sends(graph_db, ris_server, corpus):
    runner = service.GraphRunner()
    record = start(runner, corpus, "referral_013")  # the real model read "Ciara" for Clara
    assert record.status == "needs_review"
    assert record.referral.patient_first_name == "Ciara"
    assert "eligibility: not found" in record.review_reasons
    assert record.order.attempts == 0 and not ris_orders(ris_server)

    approved = runner.resume(record, ReviewAction(kind="approve", reviewer="qa"))
    assert approved.status == "sent_to_ris"
    assert approved.order.ack_code == "AA"
    assert approved.order.order_id in ris_orders(ris_server)
    assert approved.created_at == record.created_at
    assert approved.source_name == "referral_013.pdf"


def test_auth_required_path_writes_packet_and_citations(graph_db, indexed, ris_server, corpus):
    from app import rag

    record = start(service.GraphRunner(), corpus, "referral_000")  # Northgate CT chest: auth required
    assert record.auth is not None and record.auth.required
    assert record.status == "needs_review"
    assert "prior auth: missing prior_imaging" in record.review_reasons
    assert record.packet_available
    assert (graph_pipeline.PACKETS / f"{record.id}.pdf").read_bytes()[:4] == b"%PDF"
    assert record.citations, "retrieve should cite the payor's policy"
    top = record.citations[0]
    assert top.source == rag.expected_source(record.referral.payor_name, record.referral.cpt_code)
    assert top.payor == "Northgate Plan" and top.cpt == record.referral.cpt_code and top.score > 0
    assert record.keywords


def test_edit_revalidates_and_pauses_again(graph_db, ris_server, corpus):
    runner = service.GraphRunner()
    record = start(runner, corpus, "referral_013")
    original_member = record.referral.member_id

    # 1. an edit that fixes the name but breaks the member ID: validation re-runs
    fixed = record.referral.model_copy(update={
        "patient_first_name": "Clara", "member_id": "BAD-123",
        "confidence": {**record.referral.confidence, "patient_first_name": 1.0, "member_id": 1.0}})
    record = runner.resume(record, ReviewAction(kind="edit", referral=fixed,
                                                changed_fields=["patient_first_name", "member_id"]))
    assert record.status == "needs_review"
    assert record.referral.patient_first_name == "Clara"
    assert record.referral.member_id == "BAD-123"
    assert any(f.field == "member_id" and f.severity == "error" for f in record.flags)
    assert any(r.startswith("member_id:") for r in record.review_reasons)
    assert record.referral.boxes, "boxes survive an edit"

    # 2. put the member ID back: clean flags, but an edited referral still waits for a human
    restored = record.referral.model_copy(update={"member_id": original_member})
    record = runner.resume(record, ReviewAction(kind="edit", referral=restored, changed_fields=["member_id"]))
    assert record.status == "needs_review"
    assert record.referral.patient_first_name == "Clara"
    assert not any(f.field == "member_id" for f in record.flags)

    events = trace.list_for(record.id)
    assert [e.attempt for e in closing(events, "validate")] == [1, 2, 3]
    assert [e.status for e in closing(events, "human_review")] == [
        "interrupted", "ok", "interrupted", "ok", "interrupted"]
    assert [e.branch for e in closing(events, "human_review") if e.status == "ok"] == ["validate", "validate"]
    assert not [e for e in events if e.node == "order"], "an edit never auto-sends"

    # 3. approve: the corrected name is what reaches the RIS
    record = runner.resume(record, ReviewAction(kind="approve"))
    assert record.status == "sent_to_ris"
    stored = ris_orders(ris_server)[record.order.order_id]
    assert stored["patient_first_name"] == "Clara"


def test_inactive_coverage_still_works_out_prior_auth(graph_db, indexed, corpus):
    """referral_013: coverage not found, Northgate CT abdomen/pelvis. Same reasons as v1:
    the auth requirement, the policy citations and the packet are all there for the reviewer."""
    from app import rag

    record = start(service.GraphRunner(), corpus, "referral_013")
    assert record.status == "needs_review"
    assert record.eligibility.status == "not_found"
    assert record.auth is not None and record.auth.required
    assert record.review_reasons[0] == "eligibility: not found"
    assert any(r.startswith("prior auth: missing prior_imaging") for r in record.review_reasons)
    assert record.citations and record.citations[0].source == rag.expected_source(
        record.referral.payor_name, record.referral.cpt_code)
    assert record.packet_available

    events = [e for e in trace.list_for(record.id) if e.status != "running"]
    assert [e.node for e in events] == ["extract", "validate", "eligibility", "auth", "retrieve",
                                        "packet", "human_review"]


def test_reject_ends_rejected(graph_db, corpus):
    runner = service.GraphRunner()
    record = start(runner, corpus, "referral_058")  # coverage terminated
    assert record.status == "needs_review"
    assert "eligibility: terminated" in record.review_reasons

    record = runner.resume(record, ReviewAction(kind="reject", note="coverage terminated"))
    assert record.status == "rejected"
    reject = closing(trace.list_for(record.id), "reject")
    assert reject and reject[-1].status == "ok" and reject[-1].branch == "__end__"
    with pytest.raises(ValueError, match="not paused"):
        runner.resume(record, ReviewAction(kind="approve"))


def test_ris_down_then_retry_with_ris_up(graph_db, ris_server, ris_down, corpus, monkeypatch):
    monkeypatch.setenv("RIS_MLLP_PORT", str(ris_down["port"]))  # ris_server is up, but not here
    runner = service.GraphRunner()
    record = start(runner, corpus, "referral_002")
    assert record.status == "ris_error"
    assert record.order.attempts == 1 and record.order.ack_code is None
    assert "connection refused" in record.order.last_error
    assert record.error == record.order.last_error

    monkeypatch.setenv("RIS_MLLP_PORT", str(ris_server["port"]))
    record = runner.resume(record, ReviewAction(kind="retry_send"))
    assert record.status == "sent_to_ris"
    assert record.order.attempts == 2 and record.order.ack_code == "AA"
    assert f"|MSG{record.id.upper()}-2|" in record.order.message
    assert record.order.last_error is None and record.error is None

    orders = closing(trace.list_for(record.id), "order")
    assert [(e.status, e.attempt, e.branch) for e in orders] == [
        ("error", 1, "ris_wait"), ("ok", 2, "__end__")]


class _RejectingRis(socketserver.BaseRequestHandler):
    def handle(self):
        buf = b""
        while b"\x1c\r" not in buf:
            chunk = self.request.recv(4096)
            if not chunk:
                return
            buf += chunk
        ack = "MSH|^~\\&|RIS|HP|RI|HP|20260101000000||ACK^O01|1|P|2.5.1\rMSA|AE|X|simulated RIS rejection"
        self.request.sendall(b"\x0b" + ack.encode() + b"\x1c\r")


def test_ris_AE_is_ris_error_and_can_be_rejected(graph_db, corpus, monkeypatch):
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _RejectingRis)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("RIS_MLLP_HOST", "127.0.0.1")
        monkeypatch.setenv("RIS_MLLP_PORT", str(srv.server_address[1]))
        runner = service.GraphRunner()
        record = start(runner, corpus, "referral_002")
        assert record.status == "ris_error"
        assert record.order.ack_code == "AE"
        assert "MSA|AE" in record.order.ack_raw
        assert record.order.last_error == "RIS answered MSA|AE: simulated RIS rejection"

        record = runner.resume(record, ReviewAction(kind="reject", note="RIS keeps refusing"))
        assert record.status == "rejected"
    finally:
        srv.shutdown()
        srv.server_close()


def test_interrupt_survives_a_new_runner(graph_db, ris_server, corpus):
    paused = start(service.GraphRunner(), corpus, "referral_013")
    assert paused.status == "needs_review"

    service.reset()  # drop every pooled connection and the compiled graph
    record = service.GraphRunner().resume(paused, ReviewAction(kind="approve"))
    assert record.status == "sent_to_ris" and record.order.ack_code == "AA"
    assert record.referral == paused.referral


def test_wrong_action_for_the_pause_is_refused(graph_db, ris_server, corpus):
    runner = service.GraphRunner()
    record = start(runner, corpus, "referral_013")
    with pytest.raises(ValueError, match="human_review accepts"):
        runner.resume(record, ReviewAction(kind="retry_send"))
    with pytest.raises(ValueError, match="corrected referral"):
        runner.resume(record, ReviewAction(kind="edit"))
    assert runner.resume(record, ReviewAction(kind="approve")).status == "sent_to_ris"


def test_start_refuses_a_reused_id(graph_db, ris_server, corpus):
    runner = service.GraphRunner()
    record = start(runner, corpus, "referral_002")
    with pytest.raises(ValueError, match="already"):
        runner.start(record.id, str(corpus / "referral_002.pdf"), "referral_002.pdf")


def test_extraction_failure_is_failed(graph_db, tmp_path):
    pdf = tmp_path / "not_from_the_corpus.pdf"
    pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
    record = service.GraphRunner().start(new_id(), str(pdf), pdf.name)
    assert record.status == "failed"
    assert "replay only knows the corpus faxes" in record.error
    extract = closing(trace.list_for(record.id), "extract")
    assert extract[-1].status == "error" and extract[-1].branch == "__end__"


def test_start_passes_replay_pace(graph_db, ris_server, corpus):
    record = start(service.GraphRunner(), corpus, "referral_002", replay_pace_s=0.2)
    assert record.stage_timings_ms["extract"] >= 200


def test_runners_on_concurrent_threads(graph_db, ris_server, corpus):
    """The API runs start() on background threads and resume() on request threads,
    all sharing one connection pool and one compiled graph."""
    from concurrent.futures import ThreadPoolExecutor

    names = ["referral_002", "referral_005", "referral_013", "referral_058", "referral_011", "referral_016"]
    with ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(lambda n: start(service.GraphRunner(), corpus, n), names))
    by_name = dict(zip(names, records))
    assert by_name["referral_013"].status == by_name["referral_058"].status == "needs_review"
    assert all(by_name[n].status == "sent_to_ris" for n in ("referral_002", "referral_005", "referral_011", "referral_016"))
    for record in records:  # every referral's trace is its own, numbered 1..n
        seqs = [e.seq for e in trace.list_for(record.id)]
        assert seqs == list(range(1, len(seqs) + 1))

    paused = [by_name["referral_013"], by_name["referral_058"]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        done = list(pool.map(lambda r: service.GraphRunner().resume(r, ReviewAction(kind="approve")), paused))
    assert [r.status for r in done] == ["sent_to_ris", "sent_to_ris"]
    assert len(ris_orders(ris_server)) == 6
