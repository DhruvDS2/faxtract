"""Seed the demo through the HTTP API (CONTRACTS sections 5 and 12).

    python -m scripts.seed_demo [--api http://127.0.0.1:8000] [--corpus corpus/out]

What it produces, from the 60 corpus faxes:
  * every fax except the held-back ones (referral_013, _040, _057 by default;
    the live demo uploads those) is uploaded with pace_s=0, and each upload is
    polled until it settles (needs_review / sent_to_ris / ris_error / rejected /
    failed). Auto-approved referrals are sent to the RIS as they come (AA);
  * about 4 needs-review referrals are rejected, with reasons that match why
    they stopped (coverage terminated, member not found, an invalid field);
  * at least one ris_error from an AE: the demo starts the mock RIS with
    RIS_FAULT_LAST_NAMES set to the last name of one fax that auto-approves
    (plan_fault_last_name picks it from ground truth + the replayed extraction);
  * at least one ris_error from the RIS being down: the RIS is stopped, 2
    needs-review referrals are approved, and the RIS is started again;
  * 2 more needs-review referrals approved by a reviewer while the RIS is up;
  * the rest stay in needs_review for the demo.

Re-running is safe: faxes already in the API are not uploaded again, and each
scenario only runs if its outcome is not already there. Ends with counts by
status and a checklist; exits 1 if any part of the mix is missing.

RIS control (stopping/starting it) comes from the demo runner (scripts/demo.py,
state in .demo/). Without it the RIS-down step is reported as missing.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

if __package__ in (None, ""):  # `python scripts/seed_demo.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.common import ROOT, ensure_importable  # noqa: E402

ensure_importable()

DEFAULT_API = "http://127.0.0.1:8000"
CORPUS = ROOT / "corpus" / "out"
HOLD_BACK = ("referral_013", "referral_040", "referral_057")
SETTLED = ("needs_review", "sent_to_ris", "ris_error", "rejected", "failed")
REJECT_N, RIS_DOWN_N, APPROVE_N = 4, 2, 2


class SeedError(RuntimeError):
    pass


class ApiError(SeedError):
    def __init__(self, method: str, path: str, status: int, detail: str):
        super().__init__(f"{method} {path} -> HTTP {status}: {detail}")
        self.status, self.detail = status, detail


class RisControl(Protocol):
    def stop(self) -> None: ...
    def start(self) -> None: ...


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------

class Api:
    """The CONTRACTS section 5 routes the seed needs, with retries.

    GETs retry on any transport error and on 502/503/504. POSTs retry only when
    the connection was never made (so an upload or approve is never doubled)."""

    def __init__(self, client, *, retries: int = 4, backoff: float = 0.5,
                 sleep: Callable[[float], None] = time.sleep):
        self.client, self.retries, self.backoff, self.sleep = client, retries, backoff, sleep

    @property
    def base(self) -> str:
        return str(self.client.base_url).rstrip("/")

    def _call(self, method: str, path: str, expect=(200,), **kw):
        import httpx

        safe = method == "GET"
        for attempt in range(self.retries + 1):
            last = attempt == self.retries
            try:
                r = self.client.request(method, path, **kw)
            except httpx.TransportError as exc:
                retryable = safe or isinstance(exc, httpx.ConnectError)
                if retryable and not last:
                    self.sleep(self.backoff * 2 ** attempt)
                    continue
                raise SeedError(f"{method} {path}: cannot reach the API at {self.base} "
                                f"({type(exc).__name__}: {exc}). Is it running? "
                                "(make demo starts it; logs in .demo/logs/api.log)") from exc
            if r.status_code in (502, 503, 504) and not last and (safe or r.status_code == 503):
                self.sleep(self.backoff * 2 ** attempt)
                continue
            if r.status_code not in expect:
                raise ApiError(method, path, r.status_code, _detail(r))
            return r
        raise AssertionError("unreachable")

    def health(self) -> dict:
        try:
            return self._call("GET", "/health").json()
        except ApiError as exc:
            if exc.status == 404:
                raise SeedError(
                    f"GET {self.base}/health is 404: this API does not implement CONTRACTS section 5 "
                    "(it looks like the old v1 app/main.py; the seed needs Lane A's API).") from exc
            raise

    def list(self) -> list[dict]:
        return self._call("GET", "/referrals").json()

    def get(self, rid: str) -> dict:
        return self._call("GET", f"/referrals/{rid}").json()

    def upload(self, pdf: Path, pace_s: float = 0.0) -> dict:
        files = {"file": (pdf.name, pdf.read_bytes(), "application/pdf")}
        return self._call("POST", "/referrals", expect=(201, 202), files=files,
                          data={"pace_s": str(pace_s)}).json()

    def approve(self, rid: str, note: str | None = None) -> dict:
        return self._call("POST", f"/referrals/{rid}/approve", json={"reviewer": "demo-seed", "note": note}).json()

    def reject(self, rid: str, reason: str) -> dict:
        return self._call("POST", f"/referrals/{rid}/reject", json={"reviewer": "demo-seed", "reason": reason}).json()

    def wait(self, rid: str, timeout: float = 180.0, poll: float = 0.25) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            rec = self.get(rid)
            if rec.get("status") in SETTLED:
                return rec
            if time.monotonic() > deadline:
                raise SeedError(f"referral {rid} ({rec.get('source_name')}) still {rec.get('status')!r} after "
                                f"{timeout:.0f}s; see .demo/logs/api.log")
            self.sleep(poll)


def _detail(r) -> str:
    try:
        body = r.json()
    except ValueError:
        return (r.text or "").strip()[:300] or r.reason_phrase
    if isinstance(body, dict):
        detail = body.get("detail")
        if isinstance(detail, list):  # FastAPI's own 422 shape
            detail = "; ".join(str(d.get("msg", d)) for d in detail)
        extra = [f"{e.get('field')}: {e.get('message')}" for e in body.get("errors") or []]
        return " | ".join([str(detail)] + extra) if extra else str(detail)
    return str(body)[:300]


# ---------------------------------------------------------------------------
# choosing who gets what
# ---------------------------------------------------------------------------

def _last(rec_or_summary: dict) -> str:
    ref = rec_or_summary.get("referral") or {}
    name = ref.get("patient_last_name")
    if name is None and rec_or_summary.get("patient_name"):  # summary: "Last, First"
        name = rec_or_summary["patient_name"].split(",")[0]
    return (name or "").strip().lower()


def _stem(source_name: str) -> str:
    return Path(source_name or "").stem


def _blocking(rec: dict) -> list[dict]:
    return [f for f in rec.get("flags") or [] if f.get("severity") == "error"]


def rejection_reason(rec: dict) -> tuple[str, str] | None:
    """(category, reason) a reviewer would plausibly reject this referral for, or None."""
    elig = (rec.get("eligibility") or {}).get("status")
    if elig == "terminated":
        return ("coverage", "Coverage terminated per the payor's 271 response; returned to the referring "
                            "office to update the patient's insurance before scheduling.")
    if elig == "not_found":
        return ("member", "Payor has no record of this member (271: not found); asked the referring office "
                          "to confirm the member ID and resend the referral.")
    blocking = _blocking(rec)
    if blocking:
        f = blocking[0]
        return ("form", f"Referral can't be processed as sent ({f.get('field')}: {f.get('message')}); "
                        "requested a corrected referral from the referring office.")
    return None


def pick_rejections(records: list[dict], n: int, avoid: set[str]) -> list[tuple[dict, str]]:
    """Up to n needs-review referrals with a sensible reason, round-robin over reason kinds."""
    by_kind: dict[str, list[tuple[dict, str]]] = {}
    for rec in sorted(records, key=lambda r: r.get("source_name", "")):
        if rec.get("status") != "needs_review" or rec["id"] in avoid:
            continue
        why = rejection_reason(rec)
        if why:
            by_kind.setdefault(why[0], []).append((rec, why[1]))
    picked: list[tuple[dict, str]] = []
    while len(picked) < n and any(by_kind.values()):
        for kind in ("coverage", "member", "form"):
            if by_kind.get(kind) and len(picked) < n:
                picked.append(by_kind[kind].pop(0))
    return picked


def pick_approvals(records: list[dict], n: int, avoid: set[str], fault_names: set[str]) -> list[dict]:
    """Needs-review referrals a reviewer can approve: no error flags, coverage active, and
    not a fault-injected last name. Prefers ones held only for prior-auth paperwork."""
    ok = []
    for rec in sorted(records, key=lambda r: r.get("source_name", "")):
        if rec.get("status") != "needs_review" or rec["id"] in avoid or _blocking(rec):
            continue
        if _last(rec) in fault_names:
            continue
        if (rec.get("eligibility") or {}).get("status") in ("terminated", "not_found"):
            continue
        reasons = rec.get("review_reasons") or []
        paperwork_only = bool(reasons) and all(r.startswith("prior auth:") for r in reasons)
        ok.append((0 if paperwork_only else 1, rec))
    ok.sort(key=lambda t: t[0])
    return [rec for _, rec in ok[:n]]


def plan_fault_last_name(corpus_dir: Path = CORPUS, hold_back=HOLD_BACK) -> tuple[str, str] | None:
    """(last name, file) of the seeded fax the RIS should answer with AE.

    Uses ground truth plus the replay engine and the shared gate, so the pick is a
    fax that auto-approves under EXTRACTOR=replay and gets sent during seeding.
    The name must not belong to a held-back fax (the live demo expects AA), and
    the name shared by the fewest other faxes wins (ties: lowest file name)."""
    from app.auth_packet import auth_requirement
    from app.contracts import confidence_threshold
    from app.edi import build_270, parse_271
    from app.extract_replay import extract as replay
    from app.gate import review_reasons
    from app.payor import respond
    from app.pipeline import CLINIC_NPI
    from app.validate import validate

    truth_path = Path(corpus_dir) / "ground_truth.json"
    truth = json.loads(truth_path.read_text())
    rows = []
    for name in sorted(truth):
        try:
            ref, _ = replay(Path(corpus_dir) / name)
        except Exception:  # a fax replay can't serve simply isn't a candidate
            continue
        elig = parse_271(respond(build_270(ref, CLINIC_NPI)))
        auto = not review_reasons(validate(ref, confidence_threshold()), elig, auth_requirement(ref))
        names = {(ref.patient_last_name or "").strip().lower(),
                 (truth[name].get("patient_last_name") or "").strip().lower()} - {""}
        rows.append({"file": name, "stem": Path(name).stem, "last": (ref.patient_last_name or "").strip(),
                     "names": names, "auto": auto})
    held = set().union(*[r["names"] for r in rows if r["stem"] in hold_back]) if rows else set()
    best = None
    for r in rows:
        if not r["auto"] or r["stem"] in hold_back or not r["last"] or r["names"] & held:
            continue
        sharing = sum(1 for o in rows if o is not r and o["names"] & r["names"])
        key = (sharing, r["file"])
        if best is None or key < best[0]:
            best = (key, r)
    return (best[1]["last"], best[1]["file"]) if best else None


# ---------------------------------------------------------------------------
# the seed
# ---------------------------------------------------------------------------

@dataclass
class Report:
    uploaded: list[str] = field(default_factory=list)
    already_present: list[str] = field(default_factory=list)
    failed_uploads: list[str] = field(default_factory=list)
    rejected: list[str] = field(default_factory=list)
    ris_down: list[str] = field(default_factory=list)
    ae: list[str] = field(default_factory=list)
    approved: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)
    checks: list[tuple[str, bool, str]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(ok for _, ok, _ in self.checks)


def _wait_ris(api: Api, want: str, timeout: float, sleep) -> bool:
    deadline = time.monotonic() + timeout
    while True:
        if api.health().get("ris") == want:
            return True
        if time.monotonic() > deadline:
            return False
        sleep(0.25)


def seed(api: Api, corpus_dir: Path = CORPUS, *, ris: RisControl | None = None,
         hold_back=HOLD_BACK, fault_names=(), n_reject: int = REJECT_N, n_down: int = RIS_DOWN_N,
         n_approve: int = APPROVE_N, timeout: float = 180.0, log=print) -> Report:
    report = Report()
    sleep = api.sleep
    fault = {n.strip().lower() for n in fault_names if n and n.strip()}

    health = api.health()
    log(f"API {api.base}: pipeline={health.get('pipeline')} extractor={health.get('extractor')} "
        f"ris={health.get('ris')} db={health.get('db')}")
    if health.get("db") is False:
        raise SeedError("the API reports db=false: it cannot reach Postgres (check DATABASE_URL / .demo/logs/api.log)")
    if health.get("ris") != "up":
        raise SeedError("the API reports ris=down before seeding: start the mock RIS first "
                        "(make demo does; logs in .demo/logs/ris.log)")
    if health.get("extractor") != "replay":
        log(f"  note: EXTRACTOR={health.get('extractor')}; the mix below was planned for replay")

    faxes = sorted(Path(corpus_dir).glob("referral_*.pdf"))
    if not faxes:
        raise SeedError(f"no faxes in {corpus_dir}: run `python corpus/generate_faxes.py --seed 42 --count 60`")
    held = set(hold_back)
    to_seed = [f for f in faxes if f.stem not in held]
    present = {s.get("source_name") for s in api.list()}

    # 1. uploads -------------------------------------------------------------
    n_fail_streak = 0
    todo = [f for f in to_seed if f.name not in present]
    report.already_present = [f.name for f in to_seed if f.name in present]
    log(f"uploading {len(todo)} faxes ({len(report.already_present)} already present, "
        f"held back for the live demo: {', '.join(sorted(held))})")
    for i, pdf in enumerate(todo, 1):
        t0 = time.monotonic()
        rec = api.upload(pdf, pace_s=0.0)
        rec = api.wait(rec["id"], timeout=timeout)
        ack = (rec.get("order") or {}).get("ack_code")
        log(f"  [{i:>2}/{len(todo)}] {pdf.name} -> {rec['id']} {rec['status']}"
            + (f" ({ack})" if ack else "") + f"  {time.monotonic() - t0:.1f}s")
        if rec["status"] == "failed":
            report.failed_uploads.append(pdf.name)
            log(f"         error: {rec.get('error')}")
            n_fail_streak += 1
            if n_fail_streak >= 3 and len(report.failed_uploads) == i:
                raise SeedError(f"the pipeline failed the first {i} uploads; last error: {rec.get('error')} "
                                "(see .demo/logs/api.log)")
        else:
            n_fail_streak = 0
        report.uploaded.append(pdf.name)

    def refresh() -> list[dict]:
        return [api.get(s["id"]) for s in api.list() if _stem(s.get("source_name")) not in held]

    records = refresh()
    touched: set[str] = set()

    # 2. AE from the fault-injected last name ----------------------------------
    ae = [r for r in records if r["status"] == "ris_error" and (r.get("order") or {}).get("ack_code") in ("AE", "AR")]
    if not ae and fault:
        for rec in records:
            if rec["status"] == "needs_review" and _last(rec) in fault and not _blocking(rec):
                log(f"no AE yet; approving {rec['source_name']} ({_last(rec).title()} is a fault name)")
                ae.append(api.approve(rec["id"], note="demo seed: fault-injected RIS rejection"))
                break
    report.ae = [f"{r['source_name']} ({r['id']})" for r in ae if r["status"] == "ris_error"]
    touched |= {r["id"] for r in ae}

    # 3. rejections -------------------------------------------------------------
    already_rejected = [r for r in records if r["status"] == "rejected"]
    for rec, reason in pick_rejections(records, max(0, n_reject - len(already_rejected)), touched):
        out = api.reject(rec["id"], reason)
        touched.add(rec["id"])
        report.rejected.append(f"{rec['source_name']} ({rec['id']})")
        log(f"rejected {rec['source_name']} -> {out['status']}: {reason}")

    # 4. RIS down -----------------------------------------------------------------
    records = refresh()
    down = [r for r in records if r["status"] == "ris_error" and not (r.get("order") or {}).get("ack_code")]
    need = max(0, n_down - len(down))
    if need and ris is None:
        log("RIS-down step skipped: no RIS control (run the seed from the demo runner: python -m scripts.demo up)")
    elif need:
        picks = pick_approvals(records, need, touched, fault)
        if picks:
            log(f"stopping the RIS to approve {len(picks)} referral(s) while it is down")
            ris.stop()
            try:
                if not _wait_ris(api, "down", 15, sleep):
                    raise SeedError("stopped the RIS but GET /health still reports ris=up")
                for rec in picks:
                    out = api.approve(rec["id"], note="demo seed: approved while the RIS was down")
                    touched.add(rec["id"])
                    err = (out.get("order") or {}).get("last_error")
                    log(f"  approved {rec['source_name']} with the RIS down -> {out['status']} ({err})")
                    if out["status"] == "ris_error":
                        down.append(out)
            finally:
                ris.start()
                up = _wait_ris(api, "up", 30, sleep)
                log("RIS restarted" if up else "WARNING: restarted the RIS but /health does not report it up yet")
    report.ris_down = [f"{r['source_name']} ({r['id']})" for r in down]

    # 5. reviewer approvals with the RIS up --------------------------------------
    records = refresh()
    human_sent = [r for r in records if r["status"] == "sent_to_ris"
                  and any(e.get("action") == "approve" for e in r.get("reviews") or [])]
    for rec in pick_approvals(records, max(0, n_approve - len(human_sent)), touched, fault):
        out = api.approve(rec["id"], note="demo seed: prior imaging confirmed on file")
        touched.add(rec["id"])
        report.approved.append(f"{rec['source_name']} ({rec['id']})")
        log(f"approved {rec['source_name']} -> {out['status']}")

    # 6. summary ---------------------------------------------------------------------
    summaries = api.list()
    seeded = [s for s in summaries if _stem(s.get("source_name")) not in held]
    report.counts = dict(Counter(s["status"] for s in summaries))
    final = {r["id"]: r for r in refresh()}
    ae_now = [r for r in final.values() if r["status"] == "ris_error"
              and (r.get("order") or {}).get("ack_code") in ("AE", "AR")]
    down_now = [r for r in final.values() if r["status"] == "ris_error"
                and not (r.get("order") or {}).get("ack_code")]
    missing = sorted({f.name for f in to_seed} - {s.get("source_name") for s in seeded})
    c = report.counts
    report.checks = [
        ("all non-held-back faxes uploaded", not missing, f"missing: {missing}" if missing else f"{len(seeded)} seeded"),
        ("auto-approved and sent (AA)", c.get("sent_to_ris", 0) >= 1, f"sent_to_ris={c.get('sent_to_ris', 0)}"),
        ("needs review", c.get("needs_review", 0) >= 1, f"needs_review={c.get('needs_review', 0)}"),
        ("rejected with reasons", c.get("rejected", 0) >= 1, f"rejected={c.get('rejected', 0)}"),
        ("ris_error from AE", bool(ae_now),
         f"{len(ae_now)}" if ae_now else "none: the RIS needs RIS_FAULT_LAST_NAMES set to an auto-approving "
                                          "fax's last name, and ris/server.py must implement it (Lane A)"),
        ("ris_error from RIS down", bool(down_now),
         f"{len(down_now)}" if down_now else "none: the seed needs RIS control (run it via python -m scripts.demo)"),
        ("no failed referrals", c.get("failed", 0) == 0,
         f"failed={c.get('failed', 0)}" + (" (see .demo/logs/api.log)" if c.get("failed") else "")),
    ]
    log("")
    log("status counts: " + ", ".join(f"{k}={v}" for k, v in sorted(c.items())) + f"  (total {len(summaries)})")
    for name, ok, detail in report.checks:
        log(f"  [{'ok' if ok else 'MISSING'}] {name}: {detail}")
    return report


# ---------------------------------------------------------------------------

def _default_ris_control():
    from scripts import demo

    state = demo.load_state()
    if state.get("ports"):
        demo.set_ports(**state["ports"])
    return demo.ris_control()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Seed the demo through the HTTP API.")
    ap.add_argument("--api", default=None, help=f"API base URL (default: the demo's, normally {DEFAULT_API})")
    ap.add_argument("--corpus", default=str(CORPUS), help="directory with referral_NNN.pdf")
    ap.add_argument("--hold-back", default=",".join(HOLD_BACK), help="comma list of faxes to leave for the live demo")
    ap.add_argument("--fault-names", default=None,
                    help="RIS_FAULT_LAST_NAMES the RIS was started with (default: from the demo state)")
    ap.add_argument("--reject", type=int, default=REJECT_N)
    ap.add_argument("--ris-down", type=int, default=RIS_DOWN_N)
    ap.add_argument("--approve", type=int, default=APPROVE_N)
    ap.add_argument("--timeout", type=float, default=180.0, help="seconds to wait for one referral to settle")
    ap.add_argument("--no-ris-control", action="store_true", help="never stop/start the RIS")
    args = ap.parse_args(argv)

    import httpx

    from scripts import demo

    state = demo.load_state()
    if args.api is None:
        port = state.get("ports", {}).get("api")
        args.api = f"http://127.0.0.1:{port}" if port else DEFAULT_API
    ris = None if args.no_ris_control else _default_ris_control()
    fault = args.fault_names
    if fault is None:
        fault = state.get("ris_fault_last_names", "")
    hold = tuple(h.strip().removesuffix(".pdf") for h in args.hold_back.split(",") if h.strip())
    t0 = time.monotonic()
    with httpx.Client(base_url=args.api, timeout=httpx.Timeout(60.0, connect=5.0)) as client:
        try:
            report = seed(Api(client), Path(args.corpus), ris=ris, hold_back=hold,
                          fault_names=fault.split(","), n_reject=args.reject, n_down=args.ris_down,
                          n_approve=args.approve, timeout=args.timeout,
                          log=lambda m: print(m, flush=True))
        except SeedError as exc:
            print(f"seed: FAILED: {exc}", file=sys.stderr, flush=True)
            return 2
    print(f"seed: {'done' if report.ok else 'INCOMPLETE'} in {time.monotonic() - t0:.0f}s", flush=True)
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
