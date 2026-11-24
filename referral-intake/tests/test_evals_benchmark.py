"""The v1-vs-v2 benchmark artifact: schema, internal consistency, and a real (small) run."""
import json
import os
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import pytest

from app.contracts import BenchmarkReport
from evals import benchmark
from evals.scoring import CRITICAL_FIELDS

EVALS = Path(benchmark.__file__).parent
REQUIRED_NODES = {"extract", "validate", "eligibility", "auth", "retrieve", "packet", "human_review", "order"}


def _committed() -> dict:
    return json.loads((EVALS / "benchmark_v1_v2.json").read_text())


def test_committed_benchmark_validates_against_the_contract():
    report = BenchmarkReport.model_validate(_committed())
    assert report.schema_version == 1
    assert report.corpus["n"] == 60
    assert report.corpus["truth_version"] in ("as_printed", "pre_fix", "post_fix")
    assert report.extraction["engine"] == "replay"
    assert report.critical_fields == CRITICAL_FIELDS
    assert report.v1.pipeline == "v1" and report.v2.pipeline == "graph"


def test_committed_benchmark_is_internally_consistent():
    report = BenchmarkReport.model_validate(_committed())
    n = report.corpus["n"]
    for side in (report.v1, report.v2):
        for count in (side.retrieval_hit_at_1_with_cpt, side.retrieval_hit_at_1_without_cpt):
            assert 0 <= count.hits <= count.n <= n
        assert side.false_approvals == len(side.false_approval_files) <= side.auto_approved <= n
        assert side.latency_ms.n == n and side.latency_ms.p50 <= side.latency_ms.p95
        assert side.extraction_latency_ms.n == n
        assert side.cost_per_referral_usd > 0
    assert REQUIRED_NODES <= set(report.v2.node_timings_ms)
    flagged = {(c.file, p) for c in report.false_approval_cases for p in c.pipelines}
    for side in (report.v1, report.v2):
        assert {f for f, p in flagged if p == side.pipeline} == set(side.false_approval_files)
    for case in report.false_approval_cases:
        assert case.field in CRITICAL_FIELDS and len(case.explanation) > 80
    by_version = report.corpus["false_approvals_by_truth_version"]
    assert by_version[report.corpus["truth_version"]]["v1"]["files"] == report.v1.false_approval_files


def test_markdown_is_rendered_from_the_json():
    assert (EVALS / "benchmark_v1_v2.md").read_text() == benchmark.render_markdown(_committed())


@pytest.fixture
def bench_db(db, corpus, monkeypatch):
    """A fresh database with the policy chunks indexed, replay extraction."""
    from app import rag
    from app.db import SessionLocal
    from app.vectorstore import Chunk
    from graph import service

    monkeypatch.setenv("EXTRACTOR", "replay")
    chunks, vectors = rag._index()
    with SessionLocal() as session:
        for c, vec in zip(chunks, vectors):
            session.add(Chunk(source=c["source"], payor=c["payor"], cpt=c["cpt"], text=c["text"], embedding=vec))
        session.commit()
    service.reset()
    yield db
    service.reset()


def test_a_small_benchmark_run_writes_a_valid_report(bench_db, tmp_path):
    out = tmp_path / "bench.json"
    report = benchmark.run(limit=4, out_json=out, out_md=tmp_path / "bench.md", quiet=True)

    data = json.loads(out.read_text())
    assert BenchmarkReport.model_validate(data) == report
    assert report.corpus["n"] == 4
    assert report.v1.auto_approved == report.v2.auto_approved  # same gate, same replayed input
    assert report.v1.retrieval_hit_at_1_with_cpt.n == 4
    assert "referral_002.pdf" not in report.v2.false_approval_files
    assert (tmp_path / "bench.md").read_text() == benchmark.render_markdown(data)
    assert not list(tmp_path.glob(".bench.json.*.tmp")), "written atomically"
