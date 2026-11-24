"""v1 vs v2 on the same 60 faxes: python -m evals.benchmark

Writes evals/benchmark_v1_v2.json (schema: app.contracts.BenchmarkReport) and
evals/benchmark_v1_v2.md (a table rendered from that JSON, never typed by hand).

    v1  app.pipeline.process (unchanged) + app.gate + an MLLP send when the gate passes;
        retrieval measured with app.policy.retrieve (keyword overlap)
    v2  graph.service.GraphRunner, run to its first pause or its end, no human;
        retrieval measured with app.rag.retrieve_3step (the 3-step hybrid RAG it serves)

Both run EXTRACTOR=replay: the committed real Claude run (evals/extraction_eval.json),
so both pipelines see identical, genuine model output, mistakes included, with no
key and no cost. Auto-approved orders really go out, to an in-process mock RIS on
an ephemeral port (its own temp order store; the repo's ris/orders.json is untouched).

Needs DATABASE_URL (v2 checkpoints + trace rows + the pgvector policy chunks; run
scripts/index_chunks.py first) and the corpus (corpus/generate_faxes.py --seed 42).

Truth. The replayed predictions were read off the pages as printed *before* the
ground-truth fix (evals/gt_changes.json). Every fax is scored against the truth of
the page the model actually saw ("as printed"): the fixed truth, except that fields
whose printed value the fix changed keep the value that page printed. The false
approvals under the pure pre-fix and pure post-fix truth are reported alongside.
"""
import argparse
import hashlib
import json
import os
import statistics
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.contracts import (BenchmarkReport, Count, FalseApprovalCase, Percentiles,
                           PipelineBenchmark, confidence_threshold, token_cost)
from evals.safety import write_json_atomic
from evals.scoring import CRITICAL_FIELDS, field_matches

ROOT = Path(__file__).parent.parent
CORPUS = ROOT / "corpus" / "out"
ARTIFACT = Path(__file__).parent / "extraction_eval.json"
GT_CHANGES = Path(__file__).parent / "gt_changes.json"
OUT_JSON = Path(__file__).parent / "benchmark_v1_v2.json"
OUT_MD = Path(__file__).parent / "benchmark_v1_v2.md"

V1_RETRIEVER = "app.policy.retrieve (keyword overlap, whole documents)"
V2_RETRIEVER = "app.rag.retrieve_3step (3-step hybrid RAG on pgvector)"
TRUTH_VERSIONS = ("as_printed", "pre_fix", "post_fix")

# Plain-English reasons for the generator defects evals/gt_changes.json lists.
DEFECTS = {
    "laterality": "the old generator drew the side at random instead of taking it from the study "
                  "(\"Diagnostic mammography bilateral\" cannot be n/a) or from the right-sided ICD-10 codes",
}


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def percentiles(values) -> Percentiles:
    values = sorted(float(v) for v in values)
    if not values:
        return Percentiles(p50=0.0, p95=0.0, mean=None, n=0)

    def pct(p):
        k = (len(values) - 1) * p
        lo = int(k)
        hi = min(lo + 1, len(values) - 1)
        return values[lo] + (values[hi] - values[lo]) * (k - lo)

    return Percentiles(p50=round(pct(0.50), 3), p95=round(pct(0.95), 3),
                       mean=round(statistics.fmean(values), 3), n=len(values))


def git_commit() -> str | None:
    """HEAD, with "+dirty" when tracked files other than this run's outputs differ from it."""
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
        status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no", "."], cwd=ROOT,
                                capture_output=True, text=True, check=True).stdout.splitlines()
    except Exception:
        return None
    outputs = (OUT_JSON.name, OUT_MD.name)
    dirty = [line for line in status if not line.rstrip().endswith(outputs)]
    return head + ("+dirty" if dirty else "") if head else None


def parse_ack(ack: str):
    from graph.pipeline import parse_ack as parse

    return parse(ack)


@contextmanager
def in_process_ris():
    """The mock RIS (ris.server) on an ephemeral localhost port with a throwaway store."""
    from ris import server as ris

    saved = {k: os.environ.get(k) for k in ("RIS_MLLP_HOST", "RIS_MLLP_PORT", "RIS_STORE_PATH",
                                            "RIS_FAULT_LAST_NAMES")}
    store = Path(tempfile.mkdtemp(prefix="benchmark-ris-")) / "orders.json"
    os.environ["RIS_STORE_PATH"] = str(store)
    os.environ.pop("RIS_FAULT_LAST_NAMES", None)
    srv = ris.Server(("127.0.0.1", 0), ris.Handler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    os.environ["RIS_MLLP_HOST"], os.environ["RIS_MLLP_PORT"] = "127.0.0.1", str(srv.server_address[1])
    try:
        yield {"host": "127.0.0.1", "port": srv.server_address[1], "store": store}
    finally:
        srv.shutdown()
        srv.server_close()
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# --------------------------------------------------------------------------
# truth
# --------------------------------------------------------------------------

def load_truths(files):
    """{version: {file: {field: value}}} for the three truth versions, plus the gt change log."""
    post = json.loads((CORPUS / "ground_truth.json").read_text())
    artifact = {r["file"]: r for r in json.loads(ARTIFACT.read_text())["records"]}
    changes = json.loads(GT_CHANGES.read_text())

    # The corpus on disk must be the fixed one, or "post-fix" would be a lie.
    for change in changes["changes"]:
        for f in change["fields"]:
            have = post[change["file"]].get(f["field"])
            if json.dumps(have) != json.dumps(f["new"]):
                raise SystemExit(f"corpus/out is not the fixed corpus ({change['file']} {f['field']}={have!r}, "
                                 f"expected {f['new']!r}). Regenerate: python corpus/generate_faxes.py --seed 42 --count 60")

    pre = {name: {f["field"]: f["truth"] for f in artifact[name]["fields"]} for name in files}
    as_printed = {}
    reprinted = {}
    for name in files:
        row = dict(post[name])
        for change in changes["changes"]:
            if change["file"] != name:
                continue
            for f in change["fields"]:
                if f["printed"]:  # the model saw the old print
                    row[f["field"]] = f["old"]
                    reprinted.setdefault(name, []).append(f["field"])
        as_printed[name] = row
    return {"as_printed": as_printed, "pre_fix": pre, "post_fix": {n: post[n] for n in files}}, changes, reprinted


def wrong_critical(referral, truth: dict) -> list[str]:
    return [f for f in CRITICAL_FIELDS
            if f in truth and not field_matches(f, getattr(referral, f), truth[f])]


# --------------------------------------------------------------------------
# the two pipelines
# --------------------------------------------------------------------------

def run_v1(pdf: Path, threshold: float) -> dict:
    import app.pipeline as v1
    from app.gate import review_reasons
    from app.hl7 import build_orm, send_mllp

    rid = uuid.uuid4().hex[:8].upper()
    t0 = time.perf_counter()
    processed = v1.process(pdf, confidence_threshold=threshold)
    reasons = review_reasons(processed.flags, processed.eligibility, processed.auth)
    assert (not reasons) == (processed.status == "auto_approved"), "app.gate and v1 disagree"
    ack_code = None
    send_ms = 0.0
    if not reasons:
        t_send = time.perf_counter()
        msg = build_orm(processed.referral, f"ORD{rid}", f"MRN{rid}", f"MSG{rid}-1")
        try:
            ack_code, _ = parse_ack(send_mllp(msg, host=os.environ["RIS_MLLP_HOST"],
                                              port=int(os.environ["RIS_MLLP_PORT"])))
        except OSError:
            ack_code = None
        send_ms = (time.perf_counter() - t_send) * 1000
    total_ms = (time.perf_counter() - t0) * 1000
    timings = dict(processed.stage_timings_ms)
    if send_ms:
        timings["send"] = send_ms
    return {"referral": processed.referral, "auto": not reasons, "reasons": reasons,
            "status": ("sent_to_ris" if ack_code == "AA" else "ris_error") if not reasons else "needs_review",
            "latency_ms": total_ms, "timings": timings, "ack": ack_code}


def run_v2(pdf: Path, runner) -> dict:
    from app import trace

    rid = uuid.uuid4().hex[:8]
    t0 = time.perf_counter()
    record = runner.start(rid, str(pdf), pdf.name)
    total_ms = (time.perf_counter() - t0) * 1000
    events = [e for e in trace.list_for(rid) if e.status != "running"]
    auto = record.status in ("auto_approved", "sent_to_ris", "ris_error") and not any(
        e.node == "human_review" for e in events)
    return {"referral": record.referral, "auto": auto, "reasons": record.review_reasons,
            "status": record.status, "latency_ms": total_ms,
            "timings": [(e.node, e.duration_ms) for e in events],
            "ack": record.order.ack_code,
            "top_citation": record.citations[0].source if record.citations else None}


def retrieval_hits(referral, expected: str | None) -> dict:
    """Top-1 doc for both retrievers, with and without the CPT code."""
    from app import policy, rag

    out = {}
    for with_cpt in (True, False):
        t0 = time.perf_counter()
        docs = policy.retrieve(referral.payor_name, referral.cpt_code if with_cpt else None,
                               referral.icd10_codes, k=1)
        v1_ms = (time.perf_counter() - t0) * 1000
        v1_top = rag.source_stem(docs[0]["path"]) if docs else None

        q = rag.referral_query(referral, include_cpt=with_cpt)
        t0 = time.perf_counter()
        found = rag.retrieve_3step(q["indication"], q["codes"], q["payor"], k=3)
        v2_ms = (time.perf_counter() - t0) * 1000
        v2_top = rag.source_stem(found["results"][0][0]["source"]) if found["results"] else None

        key = "with_cpt" if with_cpt else "without_cpt"
        out[key] = {"v1": v1_top, "v2": v2_top, "v1_ms": v1_ms, "v2_ms": v2_ms,
                    "v1_hit": expected is not None and v1_top == expected,
                    "v2_hit": expected is not None and v2_top == expected}
    return out


# --------------------------------------------------------------------------
# false-approval explanations
# --------------------------------------------------------------------------

def explain(file, field, predicted, truth, confidence, threshold, pipelines, facts, change) -> str:
    from app.validate import STUDIES

    ref = facts["referral"]
    study = STUDIES.get(ref.cpt_code or "", {})
    conf = f"{confidence:.2f}" if confidence is not None else "no stated"
    parts = [f"{file} ({facts['template']}, {facts['degradation']} scan): the model read "
             f"{field} as {predicted!r} where the page shows {truth!r}, with {conf} confidence, "
             f"above the {threshold:.2f} threshold."]
    if field in ("patient_first_name", "patient_last_name"):
        parts.append("No validation rule can tell a plausible misspelling of a name from the right one.")
    elif field == "laterality":
        needs = study.get("laterality_required")
        parts.append(f"CPT {ref.cpt_code} ({study.get('description', 'unknown study')}) "
                     + ("requires a side, and the model gave one, so validation passed."
                        if needs else "does not require a side, so validation accepts any value."))
    else:
        parts.append("The wrong value still has a valid format, so validation passed.")
    elig = facts["eligibility"]
    auth = facts["auth"]
    gate = f"Coverage came back {elig.replace('_', ' ')}" if elig else "Coverage was not checked"
    if auth and auth.required:
        gate += f", {ref.payor_name} requires prior auth with nothing missing"
    else:
        gate += f", and {ref.payor_name} needs no prior auth for this study"
    names = " and ".join("v2" if p == "graph" else "v1" for p in pipelines)
    parts.append(f"{gate}, so the gate auto-approved it ({names}) and the ORM went to the RIS with "
                 f"{field} = {predicted!r}.")
    if change:
        why = DEFECTS.get(field, change["rule"])
        parts.append(f"The printed {truth!r} was itself a ground-truth generator defect: {why}. The fixed "
                     f"generator prints {change['new']!r}, which is what the model answered, so this case is "
                     f"expected to disappear when the fixed corpus is re-extracted (NEEDS KEYS).")
    return " ".join(parts)


# --------------------------------------------------------------------------
# the run
# --------------------------------------------------------------------------

def run(limit: int | None = None, out_json: Path = OUT_JSON, out_md: Path = OUT_MD, quiet=False) -> BenchmarkReport:
    from app.db import SessionLocal, init_db
    from app.vectorstore import Chunk
    from graph import pipeline as graph_pipeline
    from graph import service

    say = (lambda *a: None) if quiet else print
    os.environ["EXTRACTOR"] = "replay"
    threshold = confidence_threshold()
    init_db()
    with SessionLocal() as s:
        if not s.query(Chunk).count():
            raise SystemExit("policy_chunks is empty: run `python -m scripts.index_chunks` first")
    service.setup()

    artifact = json.loads(ARTIFACT.read_text())
    records = {r["file"]: r for r in artifact["records"]}
    files = sorted(records)[: limit or None]
    truths, gt_changes, reprinted = load_truths(files)
    post = truths["post_fix"]

    packets_dir = graph_pipeline.PACKETS
    graph_pipeline.PACKETS = Path(tempfile.mkdtemp(prefix="benchmark-packets-"))  # keep packets/ clean
    runner = service.GraphRunner()
    v1, v2, retrieval = {}, {}, {}

    try:
        stored = _run_all(files, threshold, runner, post, v1, v2, retrieval, say)
    finally:
        graph_pipeline.PACKETS = packets_dir
    report = _report(files, threshold, records, artifact, truths, gt_changes, reprinted, v1, v2, retrieval, stored)
    write_json_atomic(out_json, report.model_dump(mode="json"))
    out_md.write_text(render_markdown(json.loads(Path(out_json).read_text())))
    say(f"wrote {out_json} and {out_md}")
    return report


def _run_all(files, threshold, runner, post, v1, v2, retrieval, say) -> dict:
    from app import rag

    with in_process_ris() as ris:
        # warm-up, untimed: embedding model, policy files, connection pool, RIS socket
        run_v1(CORPUS / files[0], threshold)
        run_v2(CORPUS / files[0], runner)
        say(f"benchmark: {len(files)} faxes, threshold {threshold}, RIS on :{ris['port']}")
        for name in files:
            pdf = CORPUS / name
            v1[name] = run_v1(pdf, threshold)
            v2[name] = run_v2(pdf, runner)
            expected = rag.expected_source(post[name]["payor_name"], post[name]["cpt_code"])
            retrieval[name] = {"expected": expected, **retrieval_hits(v2[name]["referral"], expected)}
            say(f"  {name}: v1 {v1[name]['status']:<12} v2 {v2[name]['status']:<12} "
                f"{v1[name]['latency_ms']:7.1f} / {v2[name]['latency_ms']:7.1f} ms")
        return json.loads(ris["store"].read_text()) if ris["store"].exists() else {}


def _report(files, threshold, records, artifact, truths, gt_changes, reprinted, v1, v2, retrieval,
            stored) -> BenchmarkReport:
    # ---------------- false approvals, per truth version
    by_version = {}
    for version in TRUTH_VERSIONS:
        by_version[version] = {}
        for label, runs in (("v1", v1), ("graph", v2)):
            files_wrong = sorted(n for n in files if runs[n]["auto"]
                                 and wrong_critical(runs[n]["referral"], truths[version][n]))
            by_version[version][label] = {"false_approvals": len(files_wrong), "files": files_wrong}

    # the earlier claim: validate() only, pre-fix truth (evals/scoring.sweep_thresholds' gate)
    from app.validate import is_auto_approvable, validate

    narrow_auto = [n for n in files if is_auto_approvable(validate(v1[n]["referral"], threshold))]
    narrow_false = sorted(n for n in narrow_auto if wrong_critical(v1[n]["referral"], truths["pre_fix"][n]))

    cases = {}
    for label, runs in (("v1", v1), ("graph", v2)):
        for name in files:
            if not runs[name]["auto"]:
                continue
            for field in wrong_critical(runs[name]["referral"], truths["as_printed"][name]):
                case = cases.setdefault((name, field), {"pipelines": [], "run": runs[name]})
                case["pipelines"].append(label)
    from app.auth_packet import auth_requirement
    from app.edi import build_270, parse_271
    from app.payor import respond
    from app.pipeline import CLINIC_NPI

    false_cases = []
    for (name, field), case in sorted(cases.items()):
        ref = case["run"]["referral"]
        conf = ref.confidence.get(field)
        change = next((f for c in gt_changes["changes"] if c["file"] == name
                       for f in c["fields"] if f["field"] == field and f["printed"]), None)
        facts = {"referral": ref, "template": records[name]["template"],
                 "degradation": records[name]["degradation"],
                 "eligibility": parse_271(respond(build_270(ref, CLINIC_NPI))).status,
                 "auth": auth_requirement(ref)}
        predicted = getattr(ref, field)
        truth = truths["as_printed"][name][field]
        false_cases.append(FalseApprovalCase(
            file=name, pipelines=case["pipelines"], field=field,
            predicted=predicted if not hasattr(predicted, "isoformat") else predicted.isoformat(),
            truth=truth, confidence=conf,
            explanation=explain(name, field, predicted, truth, conf, threshold, case["pipelines"], facts, change)))

    # ---------------- latency, cost, timings
    extraction_ms = [records[n]["latency_ms"] for n in files if records[n].get("latency_ms")]
    cost = statistics.fmean(token_cost(records[n].get("usage")) for n in files)

    def hits(key, who):
        scored = [n for n in files if retrieval[n]["expected"]]
        return Count(hits=sum(retrieval[n][key][f"{who}_hit"] for n in scored), n=len(scored))

    v1_nodes = {}
    for n in files:
        for stage, ms in v1[n]["timings"].items():
            v1_nodes.setdefault(stage, []).append(ms)
    v2_nodes = {}
    for n in files:
        for node, ms in v2[n]["timings"]:
            v2_nodes.setdefault(node, []).append(ms)

    def bench(label, runs, retriever, nodes) -> PipelineBenchmark:
        wrong = by_version["as_printed"][label]
        who = "v1" if label == "v1" else "v2"
        return PipelineBenchmark(
            pipeline=label, retriever=retriever,
            retrieval_hit_at_1_with_cpt=hits("with_cpt", who),
            retrieval_hit_at_1_without_cpt=hits("without_cpt", who),
            auto_approved=sum(runs[n]["auto"] for n in files),
            false_approvals=wrong["false_approvals"], false_approval_files=wrong["files"],
            latency_ms=percentiles(runs[n]["latency_ms"] for n in files),
            extraction_latency_ms=percentiles(extraction_ms),
            cost_per_referral_usd=round(cost, 6),
            node_timings_ms={k: percentiles(v) for k, v in nodes.items()},
        )

    sent = {label: sum(runs[n]["ack"] == "AA" for n in files) for label, runs in (("v1", v1), ("graph", v2))}
    graph_retrieved = [n for n in files if v2[n]["top_citation"]]
    agree = sum(v2[n]["top_citation"] == retrieval[n]["with_cpt"]["v2"] for n in graph_retrieved)
    same_auto = sum(v1[n]["auto"] == v2[n]["auto"] for n in files)
    v1_ret = percentiles(retrieval[n][k]["v1_ms"] for n in files for k in ("with_cpt", "without_cpt"))
    v2_ret = percentiles(retrieval[n][k]["v2_ms"] for n in files for k in ("with_cpt", "without_cpt"))
    node_work = [sum(ms for _, ms in v2[n]["timings"]) for n in files]
    overhead = percentiles(v2[n]["latency_ms"] - w for n, w in zip(files, node_work))
    misses = {who: {key: sorted(n for n in files if retrieval[n]["expected"] and not retrieval[n][key][f"{who}_hit"])
                    for key in ("with_cpt", "without_cpt")} for who in ("v1", "v2")}

    truth_file = CORPUS / "ground_truth.json"
    report = BenchmarkReport(
        generated_at=datetime.now(timezone.utc),
        git_commit=git_commit(),
        threshold=threshold,
        corpus={
            "n": len(files), "seed": 42, "source": "corpus/out (corpus/generate_faxes.py --seed 42 --count 60)",
            "ground_truth_sha256": hashlib.sha256(truth_file.read_bytes()).hexdigest(),
            "truth_version": "as_printed",
            "truth_policy": (
                "post-fix ground truth (corpus/generate_faxes.py at this commit), except that on the "
                f"{len(reprinted)} pages whose print the fix changed (evals/gt_changes.json, printed=true) "
                "the changed fields keep the value the pre-fix page printed, because the replayed "
                "prediction was read off that page. Retrieval's expected doc uses the post-fix payor + CPT "
                "(unchanged by the fix)."),
            "reprinted_pages": {n: reprinted[n] for n in sorted(reprinted)},
            "false_approvals_by_truth_version": by_version,
            "gt_changes": "evals/gt_changes.json",
        },
        extraction={
            "engine": "replay", "source": "evals/extraction_eval.json",
            "model": "not recorded in the artifact; app/extract_claude.py MODEL = claude-sonnet-4-6",
            "n_files": artifact["summary"]["n_files"],
            "recorded_cost_total_usd": artifact["summary"]["cost"]["total_dollars"],
            "note": ("Replay hands back what Claude vision actually returned per fax (values + "
                     "self-reported confidence), so both pipelines run on identical, genuine model "
                     "output. Measured latencies therefore exclude model time; the recorded model "
                     "latency is extraction_latency_ms."),
        },
        critical_fields=list(CRITICAL_FIELDS),
        v1=bench("v1", v1, V1_RETRIEVER, v1_nodes),
        v2=bench("graph", v2, V2_RETRIEVER, v2_nodes),
        false_approval_cases=false_cases,
        notes=[
            f"Same gate in both pipelines (app.gate.review_reasons): they agree on {same_auto}/{len(files)} "
            f"auto-approve decisions, so the comparison is orchestration and retrieval, not rules.",
            f"Orders really sent: v1 {sent['v1']} and v2 {sent['graph']} got MSA|AA from the in-process mock RIS "
            f"({len(stored)} orders in its store).",
            "Latency is end to end per referral with replayed extraction and no human time: v1 = "
            "process() + gate + MLLP send; v2 = GraphRunner.start() to its pause or end, including the "
            "Postgres checkpoint and trace writes, the 3-step RAG and the prior-auth packet PDF that v1 "
            "never does. One untimed warm-up run per pipeline first (model load, connection pool).",
            f"Where v2's time goes: the nodes' own work is p50 {percentiles(node_work).p50:.1f} ms per referral; "
            f"the rest (p50 {overhead.p50:.1f} ms, p95 {overhead.p95:.1f} ms) is LangGraph bookkeeping plus the "
            "Postgres checkpoint after every step and two trace rows per node, i.e. the price of pausable, "
            "resumable, inspectable runs. Next to the ~10 s model call it is noise.",
            f"Retrieval latency per query: v1 p50 {v1_ret.p50:.1f} ms / p95 {v1_ret.p95:.1f} ms, "
            f"v2 p50 {v2_ret.p50:.1f} ms / p95 {v2_ret.p95:.1f} ms. Both retrievers get the same referral "
            "(the replayed prediction); the expected doc is section 15's payor+CPT policy "
            "(app.rag.expected_source).",
            f"Hit@1 misses: v1 with CPT {misses['v1']['with_cpt']}, v1 without CPT {misses['v1']['without_cpt']}; "
            f"v2 with CPT {misses['v2']['with_cpt']}, v2 without CPT {misses['v2']['without_cpt']}.",
            f"The served graph only retrieves when prior auth is required ({len(graph_retrieved)}/{len(files)} "
            f"referrals); its top citation matches the direct retrieve_3step call on {agree}/{len(graph_retrieved)}.",
            f"The earlier '3 false approvals' claim used validate() alone, with pre-fix truth: that narrow gate "
            f"auto-approves {len(narrow_auto)}/{len(files)} and falsely approves {len(narrow_false)} "
            f"({', '.join(narrow_false) or 'none'}). The full gate (validation + eligibility + prior-auth "
            f"elements) auto-approves {sum(v1[n]['auto'] for n in files)} and falsely approves "
            f"{by_version['pre_fix']['v1']['false_approvals']} under the same pre-fix truth "
            f"({', '.join(by_version['pre_fix']['v1']['files']) or 'none'}). The others are held for coverage "
            "or prior-auth reasons, not because the gate noticed the wrong value.",
            "False approvals by truth version (v1 / v2): " + "; ".join(
                f"{v} {by_version[v]['v1']['false_approvals']} / {by_version[v]['graph']['false_approvals']}"
                for v in TRUTH_VERSIONS) + ". post_fix scores the stale replays of reprinted pages against "
            "values those pages never showed, so it overstates errors; as_printed is the headline.",
            "Cost per referral is the recorded Claude token usage x app.contracts.PRICE_PER_MTOK; v2 adds no "
            "model calls (its step-2 keyword extractor is deterministic), so both pipelines cost the same.",
        ],
    )
    return report


# --------------------------------------------------------------------------
# markdown, rendered from the JSON
# --------------------------------------------------------------------------

def _pct(c):
    return f"{c['hits']}/{c['n']} ({c['hits'] / c['n']:.0%})" if c["n"] else "n/a"


def _ms(p):
    return f"{p['p50']:.1f} / {p['p95']:.1f}" if p else "n/a"


def render_markdown(data: dict) -> str:
    v1, v2 = data["v1"], data["v2"]
    corpus, extraction = data["corpus"], data["extraction"]
    lines = [
        "# Benchmark: v1 vs v2 (served graph)",
        "",
        f"Generated from `evals/benchmark_v1_v2.json` by `python -m evals.benchmark` "
        f"({data['generated_at']}, commit `{(data.get('git_commit') or 'unknown')[:10]}`). Do not edit by hand.",
        "",
        f"{corpus['n']} faxes, extraction `{extraction['engine']}` ({extraction['source']}), "
        f"auto-approve threshold {data['threshold']}, truth version **{corpus['truth_version']}**.",
        "",
        "| | v1 (`app/pipeline.py`) | v2 (served graph) |",
        "|---|---|---|",
        f"| Retriever | {v1['retriever']} | {v2['retriever']} |",
        f"| Retrieval Hit@1, with CPT | {_pct(v1['retrieval_hit_at_1_with_cpt'])} | {_pct(v2['retrieval_hit_at_1_with_cpt'])} |",
        f"| Retrieval Hit@1, CPT removed | {_pct(v1['retrieval_hit_at_1_without_cpt'])} | {_pct(v2['retrieval_hit_at_1_without_cpt'])} |",
        f"| Auto-approved at {data['threshold']} | {v1['auto_approved']}/{corpus['n']} | {v2['auto_approved']}/{corpus['n']} |",
        f"| False approvals | {v1['false_approvals']} {v1['false_approval_files']} | {v2['false_approvals']} {v2['false_approval_files']} |",
        f"| Latency p50 / p95, ms (no human, replayed extraction) | {_ms(v1['latency_ms'])} | {_ms(v2['latency_ms'])} |",
        f"| Recorded extraction latency p50 / p95, ms | {_ms(v1.get('extraction_latency_ms'))} | {_ms(v2.get('extraction_latency_ms'))} |",
        f"| Cost per referral | ${v1['cost_per_referral_usd']:.4f} | ${v2['cost_per_referral_usd']:.4f} |",
        "",
        "## v2 per-node timings (ms, from trace events)",
        "",
        "| Node | runs | p50 | p95 | mean |",
        "|---|---|---|---|---|",
    ]
    for node, p in v2["node_timings_ms"].items():
        lines.append(f"| {node} | {p['n']} | {p['p50']:.2f} | {p['p95']:.2f} | {p['mean']:.2f} |")
    if v1.get("node_timings_ms"):
        lines += ["", "v1 stage timings (ms): " + ", ".join(
            f"{k} {p['p50']:.2f} / {p['p95']:.2f}" for k, p in v1["node_timings_ms"].items()) + " (p50 / p95)."]
    lines += ["", "## False approvals", ""]
    if not data["false_approval_cases"]:
        lines.append("None.")
    for case in data["false_approval_cases"]:
        who = ", ".join("v2" if p == "graph" else p for p in case["pipelines"])
        lines.append(f"- **{case['file']}**, `{case['field']}`: predicted `{case['predicted']}`, truth "
                     f"`{case['truth']}`, confidence {case['confidence']} ({who}). {case['explanation']}")
    lines += ["", "## Truth versions", "", corpus["truth_policy"], "",
              "| Truth version | v1 false approvals | v2 false approvals |", "|---|---|---|"]
    for version, row in corpus["false_approvals_by_truth_version"].items():
        lines.append(f"| {version} | {row['v1']['false_approvals']} {row['v1']['files']} | "
                     f"{row['graph']['false_approvals']} {row['graph']['files']} |")
    lines += ["", "## Notes", ""] + [f"- {n}" for n in data["notes"]] + [""]
    return "\n".join(lines)


def main():
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser(prog="python -m evals.benchmark", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=None, help="only the first N faxes (smoke runs)")
    ap.add_argument("--out", default=str(OUT_JSON))
    ap.add_argument("--md", default=str(OUT_MD))
    args = ap.parse_args()
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    run(args.limit, Path(args.out), Path(args.md))


if __name__ == "__main__":
    main()
