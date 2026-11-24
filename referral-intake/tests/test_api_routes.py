"""The rest of the HTTP API: upload safety, fax/page serving, health, eval
artifacts, graph structure, policy/packet/order and v1-vs-v2 retrieval compare."""
import json
import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import pytest
from fastapi.testclient import TestClient

from app.contracts import ArtifactEnvelope, RetrievalCompare

REVIEW_FAX = "referral_013.pdf"   # Northgate Plan, CPT 74177: prior auth required
NO_AUTH_FAX = "referral_004.pdf"  # Cascade Mutual, CPT 73200: no prior auth (needs review: terminated)


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
        client.tmp = tmp_path
        client.ris = ris_server
        yield client


def upload(client, fax=REVIEW_FAX, name=None):
    r = client.post("/referrals?wait=1", files={"file": (name or fax, (client.corpus / fax).read_bytes(),
                                                         "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()


def test_upload_name_traversal_is_sanitized(api):
    rec = upload(api, name="../../referral_013.pdf")
    uploads = (api.tmp / "uploads").resolve()
    stored = os.path.realpath(rec["source_file"])
    assert stored == str(uploads / rec["id"] / "referral_013.pdf")
    assert rec["source_name"] == "referral_013.pdf"
    assert rec["status"] == "needs_review"            # the corpus name survived, so replay matched it
    assert not (api.tmp / "referral_013.pdf").exists()

    rec = upload(api, name="..\\..\\x.pdf")
    assert rec["source_name"] == "x.pdf"
    assert os.path.dirname(os.path.realpath(rec["source_file"])) == str(uploads / rec["id"])

    rec = upload(api, name="my fax; rm -rf $HOME.PDF")
    assert rec["source_name"] == "my_fax__rm_-rf__HOME.pdf"
    assert len(rec["id"]) == 8 and all(c in "0123456789abcdef" for c in rec["id"])


def test_upload_non_pdf_is_400(api):
    r = api.post("/referrals?wait=1", files={"file": ("referral_013.pdf", b"GIF89a not a pdf", "application/pdf")})
    assert r.status_code == 400
    assert r.json() == {"detail": "not a PDF: the file does not start with %PDF", "errors": [],
                        "status": None, "flags": []}
    assert api.get("/referrals").json() == []
    r = api.post("/referrals", files={"file": ("empty.pdf", b"", "application/pdf")})
    assert r.status_code == 400
    assert api.post("/referrals").status_code == 422  # no file part at all


def test_pace_s_form_field_is_accepted(api, monkeypatch):
    monkeypatch.setenv("REPLAY_PACE_S", "not-a-number")  # bad env falls back to 0, never crashes
    data = (api.corpus / REVIEW_FAX).read_bytes()
    r = api.post("/referrals?wait=1", data={"pace_s": "0"}, files={"file": (REVIEW_FAX, data, "application/pdf")})
    assert r.status_code == 201 and r.json()["status"] == "needs_review"
    extract = [e for e in api.get(f"/referrals/{r.json()['id']}/trace").json()
               if e["node"] == "extract" and e["status"] == "ok"][0]
    assert extract["state_in"]["replay_pace_s"] == 0.0
    r = api.post("/referrals?wait=1", data={"pace_s": "soon"}, files={"file": (REVIEW_FAX, data, "application/pdf")})
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "pace_s"


def test_fax_pdf_has_etag_and_cache_control(api):
    rec = upload(api)
    r = api.get(f"/referrals/{rec['id']}/fax.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content == (api.corpus / REVIEW_FAX).read_bytes()
    assert r.headers["cache-control"] == "private, max-age=3600"
    etag = r.headers["etag"]
    assert etag.startswith('"')
    again = api.get(f"/referrals/{rec['id']}/fax.pdf", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""
    assert api.get("/referrals/nope0000/fax.pdf").status_code == 404


def test_page_png(api):
    pytest.importorskip("app.pages")  # Lane B's page cache (CONTRACTS §15)
    rec = upload(api)
    r = api.get(f"/referrals/{rec['id']}/pages/0.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content.startswith(b"\x89PNG")
    assert api.get(f"/referrals/{rec['id']}/pages/99.png").status_code == 404


def test_health(api, ris_down, monkeypatch):
    monkeypatch.setenv("RIS_MLLP_PORT", str(api.ris["port"]))
    body = api.get("/health").json()
    assert body == {"ok": True, "db": True, "ris": "up", "pipeline": "v1", "extractor": "replay",
                    "threshold": 0.85}
    monkeypatch.setenv("RIS_MLLP_PORT", str(ris_down["port"]))
    monkeypatch.setenv("CONFIDENCE_THRESHOLD", "0.9")
    body = api.get("/health").json()
    assert body["ris"] == "down" and body["ok"] is True and body["threshold"] == 0.9


def test_evals_envelopes(api, tmp_path, monkeypatch):
    from app.api import system

    r = api.get("/evals/extraction")
    assert r.status_code == 200
    env = ArtifactEnvelope.model_validate(r.json())
    assert env.source == "evals/extraction_eval.json"
    assert env.data["summary"]["n_files"] == 60
    # the committed artifact has no summary.run_at: its time is the file's last commit
    assert env.run_at_source in ("git", "unknown")
    if env.run_at_source == "git":
        assert env.run_at is not None

    bench = tmp_path / "benchmark_v1_v2.json"
    monkeypatch.setattr(system, "BENCHMARK", bench)
    r = api.get("/evals/benchmark")
    assert r.status_code == 404 and "has not been generated" in r.json()["detail"]
    bench.write_text(json.dumps({"schema_version": 1, "generated_at": "2026-11-23T15:00:00Z", "v1": {}}))
    env = ArtifactEnvelope.model_validate(api.get("/evals/benchmark").json())
    assert env.run_at_source == "artifact" and env.run_at.isoformat() == "2026-11-23T15:00:00+00:00"

    extraction = tmp_path / "extraction_eval.json"
    monkeypatch.setattr(system, "EXTRACTION", extraction)
    extraction.write_text(json.dumps({"summary": {"run_at": "2026-11-01T10:00:00+00:00"}, "records": []}))
    env = ArtifactEnvelope.model_validate(api.get("/evals/extraction").json())
    assert env.run_at_source == "artifact"
    extraction.write_text(json.dumps({"summary": {}, "records": []}))  # outside git: unknown
    system._git_commit_time.cache_clear()
    env = ArtifactEnvelope.model_validate(api.get("/evals/extraction").json())
    assert env.run_at_source == "unknown" and env.run_at is None


def test_graph_structure(api):
    from graph import service
    try:
        expected = service.structure()
    except NotImplementedError:
        expected = None
    r = api.get("/graph/structure")
    if expected is None:  # Lane C's graph not merged yet: a clean 501, not a 500
        assert r.status_code == 501
        assert set(r.json()) == {"detail", "errors", "status", "flags"}
    else:
        assert r.status_code == 200
        assert r.json()["active_pipeline"] == "v1"
        assert {n["id"] for n in r.json()["nodes"]} == {n.id for n in expected.nodes}


@pytest.fixture
def indexed(db):
    from scripts.index_chunks import run
    run()
    return db


def test_policy_packet_order_and_retrieval_compare(api, indexed):
    rec = upload(api)
    rid = rec["id"]
    assert rec["auth"]["required"] is True

    policy = api.get(f"/referrals/{rid}/policy").json()
    assert policy["required"] is True and policy["keywords"]
    assert policy["citations"] and all(c["payor"] == "Northgate Plan" for c in policy["citations"])
    assert policy["citations"][0]["source"].startswith("northgate-plan__")

    r = api.get(f"/referrals/{rid}/packet")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert (api.tmp / "packets" / f"{rid}.pdf").exists()

    r = api.get(f"/referrals/{rid}/retrieval-compare", params={"k": 3})
    assert r.status_code == 200, r.text
    cmp = RetrievalCompare.model_validate(r.json())
    assert cmp.referral_id == rid
    assert cmp.query["payor"] == "Northgate Plan" and cmp.query["codes"][0] == "74177"
    assert cmp.expected_source == "northgate-plan__ct-abdomen-pelvis"
    assert cmp.v1.impl == "app.policy.retrieve" and cmp.v2.impl == "app.rag.retrieve_3step"
    assert 1 <= len(cmp.v1.chunks) <= 3 and len(cmp.v2.chunks) == 3
    assert [c.rank for c in cmp.v2.chunks] == [1, 2, 3]
    assert cmp.v1.latency_ms >= 0 and cmp.v2.latency_ms > 0
    assert cmp.v2.chunks[0].source == cmp.expected_source
    assert all(c.payor == "Northgate Plan" for c in cmp.v1.chunks + cmp.v2.chunks)
    assert cmp.v1.keywords and cmp.v2.keywords


def test_no_auth_and_no_payor_are_409(api):
    rec = upload(api, fax=NO_AUTH_FAX)
    assert rec["auth"]["required"] is False
    r = api.get(f"/referrals/{rec['id']}/retrieval-compare")
    assert r.status_code == 409 and "no prior authorization" in r.json()["detail"]
    assert api.get(f"/referrals/{rec['id']}/packet").status_code == 409
    assert api.get(f"/referrals/{rec['id']}/policy").json() == {"required": False, "keywords": [], "citations": []}

    rec = upload(api)
    api.patch(f"/referrals/{rec['id']}", json={"fields": {"payor_name": ""}})
    r = api.get(f"/referrals/{rec['id']}/retrieval-compare")
    assert r.status_code == 409 and "no payor" in r.json()["detail"]


def test_page_route_uses_the_pages_interface(api, monkeypatch):
    """Route wiring against the frozen app/pages.py interface (§15) with a stand-in module,
    so it is covered before Lane B's cache merges; test_page_png covers the real one."""
    import sys
    import types

    import app as app_pkg

    calls = []
    fake = types.ModuleType("app.pages")
    fake.page_count = lambda path: 2
    fake.page_png = lambda path, page, dpi=150: calls.append((str(path), page)) or b"\x89PNG fake"
    fake.pdf_bytes = lambda path: (b"%PDF-fake", '"etag-from-pages"')
    monkeypatch.setitem(sys.modules, "app.pages", fake)
    monkeypatch.setattr(app_pkg, "pages", fake, raising=False)

    rec = upload(api)
    r = api.get(f"/referrals/{rec['id']}/pages/1.png")
    assert r.status_code == 200 and r.content == b"\x89PNG fake"
    assert calls == [(rec["source_file"], 1)]
    assert api.get(f"/referrals/{rec['id']}/pages/2.png").status_code == 404
    assert api.get(f"/referrals/{rec['id']}/pages/-1.png").status_code == 404
    r = api.get(f"/referrals/{rec['id']}/fax.pdf")
    assert r.content == b"%PDF-fake" and r.headers["etag"] == '"etag-from-pages"'
