"""scripts/seed_demo.py against a fake CONTRACTS section 5 API (httpx.MockTransport).

The fake follows the frozen lifecycle: uploads are `processing` for a few polls,
then settle; auto-approved referrals are sent at once (AA, or AE for a
fault-injected last name, or ris_error when the RIS is down); approve/reject
enforce the 409/422 rules. Nothing here needs the real API, a database or the RIS.
"""
import json
import re
from datetime import datetime, timezone

import httpx
import pytest

from scripts import seed_demo
from scripts.seed_demo import HOLD_BACK, Api, SeedError, pick_approvals, pick_rejections, seed

FAULT = "Petrov"
TERMINATED = {4, 8, 15, 23}
NOT_FOUND = {10, 18, 42, 46}
AUTO = {2, 5, 11, 12, 16, 17, 20, 24, 27, 36, 39, 40, 44, 45, 48, 50, 53, 54, 56}
BLOCKED = {19}  # has an error-severity flag: approve is a 409


def _outcome(i: int) -> dict:
    last = FAULT if i == 11 else f"Name{i:02d}"
    if i in AUTO:
        return {"last": last, "auto": True, "elig": "active_in_network", "reasons": [], "flags": []}
    reasons, flags, elig = ["prior auth: missing prior_imaging"], [], "active_in_network"
    if i in TERMINATED:
        elig, reasons = "terminated", ["eligibility: terminated"]
    if i in NOT_FOUND:
        elig, reasons = "not_found", ["eligibility: not found", *reasons]
    if i in BLOCKED:
        flags = [{"field": "referring_provider_npi", "severity": "error", "message": "NPI fails checksum"}]
        reasons = ["referring_provider_npi: NPI fails checksum", *reasons]
    return {"last": last, "auto": False, "elig": elig, "reasons": reasons, "flags": flags}


class FakeApi:
    def __init__(self, fault=(FAULT,), settle_polls=2, fail_all=False, health_404=False, outcome=_outcome):
        self.outcome = outcome
        self.records: dict[str, dict] = {}
        self.polls: dict[str, int] = {}
        self.ris_up = True
        self.fault = {f.lower() for f in fault}
        self.settle_polls, self.fail_all, self.health_404 = settle_polls, fail_all, health_404
        self.uploads: list[dict] = []
        self.calls: list[str] = []
        self.flaky = {"health": 1, "list": 1}  # one 503 and one connect error, to exercise retries
        self.n = 0

    def transport(self):
        return httpx.MockTransport(self.handle)

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _now():
        return datetime.now(timezone.utc).isoformat()

    def _send(self, rec):
        order = rec["order"]
        order["attempts"] += 1
        order["order_id"] = "ORD" + rec["id"].upper()
        if not self.ris_up:
            rec["status"], order["ack_code"] = "ris_error", None
            order["last_error"] = "connection refused (127.0.0.1:2575)"
        elif rec["referral"]["patient_last_name"].lower() in self.fault:
            rec["status"], order["ack_code"] = "ris_error", "AE"
            order["last_error"] = "MSA|AE: simulated RIS rejection"
        else:
            rec["status"], order["ack_code"], order["last_error"] = "sent_to_ris", "AA", None

    def _settle(self, rec):
        out = rec.pop("_outcome")
        if self.fail_all:
            rec["status"], rec["error"] = "failed", "NotImplementedError: Lane C implements GraphRunner.start()"
            return
        rec["review_reasons"], rec["flags"] = out["reasons"], out["flags"]
        rec["eligibility"] = {"status": out["elig"]}
        if out["auto"]:
            rec["status"] = "auto_approved"
            self._send(rec)
        else:
            rec["status"] = "needs_review"

    def _summary(self, rec):
        ref = rec["referral"]
        return {"id": rec["id"], "pipeline": "graph", "source_name": rec["source_name"], "status": rec["status"],
                "patient_name": f"{ref['patient_last_name']}, Pat", "ack_code": rec["order"]["ack_code"],
                "error_count": sum(f["severity"] == "error" for f in rec.get("flags", [])), "warning_count": 0}

    def _public(self, rec):
        return {k: v for k, v in rec.items() if not k.startswith("_")}

    @staticmethod
    def _json(status, body):
        return httpx.Response(status, json=body)

    def _err(self, status, detail, **extra):
        return self._json(status, {"detail": detail, "errors": [], "status": None, "flags": [], **extra})

    # ------------------------------------------------------------------ routes
    def handle(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append(f"{method} {path}")
        if path == "/health":
            if self.health_404:
                return self._json(404, {"detail": "Not Found"})
            if self.flaky["health"]:
                self.flaky["health"] -= 1
                return httpx.Response(503, text="starting")
            return self._json(200, {"ok": True, "db": True, "ris": "up" if self.ris_up else "down",
                                    "pipeline": "graph", "extractor": "replay", "threshold": 0.85})
        if path == "/referrals" and method == "GET":
            if self.flaky["list"]:
                self.flaky["list"] -= 1
                raise httpx.ConnectError("connection refused", request=request)
            return self._json(200, [self._summary(r) for r in self.records.values()])
        if path == "/referrals" and method == "POST":
            body = request.content.decode("latin-1")
            name = re.search(r'filename="([^"]+)"', body).group(1)
            pace = re.search(r'name="pace_s"\r\n\r\n([^\r]*)', body).group(1)
            self.uploads.append({"name": name, "pace_s": pace})
            self.n += 1
            rid = f"{self.n:08x}"
            i = int(re.search(r"referral_(\d{3})", name).group(1))
            out = self.outcome(i)
            self.records[rid] = {
                "id": rid, "pipeline": "graph", "source_name": name, "source_file": f"uploads/{rid}/{name}",
                "status": "processing", "referral": {"patient_last_name": out["last"], "patient_first_name": "Pat"},
                "flags": [], "eligibility": None, "review_reasons": [], "order": {
                    "order_id": None, "ack_code": None, "attempts": 0, "last_error": None},
                "reviews": [], "error": None, "_outcome": out, "created_at": self._now()}
            self.polls[rid] = 0
            return self._json(202, self._public(self.records[rid]))
        m = re.fullmatch(r"/referrals/([0-9a-f]{8})(/approve|/reject)?", path)
        if not m or m.group(1) not in self.records:
            return self._err(404, "not found")
        rec = self.records[m.group(1)]
        if method == "GET" and not m.group(2):
            self.polls[rec["id"]] += 1
            if rec["status"] == "processing" and self.polls[rec["id"]] >= self.settle_polls:
                self._settle(rec)
            return self._json(200, self._public(rec))
        body = json.loads(request.content or b"{}")
        if m.group(2) == "/approve":
            if rec["status"] != "needs_review":
                return self._err(409, f"cannot approve a referral in {rec['status']}", status=rec["status"])
            if any(f["severity"] == "error" for f in rec["flags"]):
                return self._err(409, "blocking flags", flags=rec["flags"])
            rec["reviews"].append({"action": "approve", "note": body.get("note")})
            rec["status"] = "approved"
            self._send(rec)
            return self._json(200, self._public(rec))
        if m.group(2) == "/reject":
            if not body.get("reason"):
                return self._err(422, "reason is required")
            if rec["status"] not in ("needs_review", "ris_error"):
                return self._err(409, "cannot reject", status=rec["status"])
            rec["reviews"].append({"action": "reject", "note": body["reason"]})
            rec["status"] = "rejected"
            return self._json(200, self._public(rec))
        return self._err(405, "method not allowed")


class FakeRis:
    def __init__(self, api: FakeApi):
        self.api, self.stops, self.starts = api, 0, 0

    def stop(self):
        self.stops += 1
        self.api.ris_up = False

    def start(self):
        self.starts += 1
        self.api.ris_up = True


@pytest.fixture
def corpus(tmp_path):
    d = tmp_path / "out"
    d.mkdir()
    for i in range(60):
        (d / f"referral_{i:03d}.pdf").write_bytes(b"%PDF-1.4\n% fake fax\n")
    return d


def _api(fake, retries=4):
    client = httpx.Client(transport=fake.transport(), base_url="http://demo.test")
    return Api(client, retries=retries, backoff=0, sleep=lambda s: None)


def _run(fake, corpus, ris="auto", **kw):
    ris = FakeRis(fake) if ris == "auto" else ris
    logs = []
    report = seed(_api(fake), corpus, ris=ris, fault_names=[FAULT], log=logs.append, **kw)
    return report, ris, logs


def _by_status(fake):
    out = {}
    for r in fake.records.values():
        out.setdefault(r["status"], []).append(r)
    return out


def test_seed_produces_the_demo_mix(corpus):
    fake = FakeApi()
    report, ris, logs = _run(fake, corpus)
    assert report.ok, report.checks

    names = [u["name"] for u in fake.uploads]
    assert len(names) == 57 == len(set(names))
    assert not {f"{h}.pdf" for h in HOLD_BACK} & set(names)  # left for the live demo
    assert {u["pace_s"] for u in fake.uploads} == {"0.0"}
    assert all(n >= fake.settle_polls for n in fake.polls.values())  # each upload was polled until it settled

    st = _by_status(fake)
    assert not st.get("processing") and not st.get("approved") and not st.get("auto_approved")
    ae = [r for r in st["ris_error"] if r["order"]["ack_code"] == "AE"]
    down = [r for r in st["ris_error"] if r["order"]["ack_code"] is None]
    assert [r["referral"]["patient_last_name"] for r in ae] == [FAULT]
    assert len(down) == 2 and all("connection refused" in r["order"]["last_error"] for r in down)
    assert all(r["reviews"][-1]["action"] == "approve" for r in down)
    assert ris.stops == 1 and ris.starts == 1 and fake.ris_up

    rejected = st["rejected"]
    assert len(rejected) == 4
    reasons = {r["source_name"]: r["reviews"][-1]["note"] for r in rejected}
    # round-robin over reason kinds: coverage terminated, member not found, an invalid field, ...
    assert sorted(reasons) == ["referral_004.pdf", "referral_008.pdf", "referral_010.pdf", "referral_019.pdf"]
    assert "terminated" in reasons["referral_004.pdf"] and "271" in reasons["referral_004.pdf"]
    assert "not found" in reasons["referral_010.pdf"]
    assert "referring_provider_npi: NPI fails checksum" in reasons["referral_019.pdf"]

    human_sent = [r for r in st["sent_to_ris"] if r["reviews"]]
    assert len(human_sent) == 2
    assert len(st["sent_to_ris"]) == len(AUTO - {11, 40}) + 2  # auto AA (minus the AE one and a held-back) + 2
    assert len(st["needs_review"]) == 57 - len(AUTO - {40}) - 4 - 2 - 2
    assert not [r for r in st["needs_review"] if r["source_name"] == "referral_019.pdf"]  # blocked: rejected
    # approvals never touch a fault name, a blocked referral, or an eligibility problem
    for r in down + human_sent:
        assert r["referral"]["patient_last_name"] != FAULT and not r["flags"]
        assert r["eligibility"]["status"] == "active_in_network"

    assert sum(report.counts.values()) == 57
    assert any("status counts" in line for line in logs)


def test_seed_is_idempotent(corpus):
    fake = FakeApi()
    first, ris, _ = _run(fake, corpus)
    before = {rid: (r["status"], len(r["reviews"])) for rid, r in fake.records.items()}
    n_calls = len(fake.uploads)
    second, ris2, logs = _run(fake, corpus)
    assert second.ok
    assert len(fake.uploads) == n_calls  # nothing re-uploaded
    assert {rid: (r["status"], len(r["reviews"])) for rid, r in fake.records.items()} == before
    assert ris2.stops == 0  # RIS-down outcome already present
    assert second.rejected == [] and second.approved == []


def test_seed_resumes_a_partial_run(corpus):
    fake = FakeApi()
    api = _api(fake)
    for i in (0, 1, 2):  # someone uploaded three faxes already
        rec = api.upload(corpus / f"referral_{i:03d}.pdf")
        api.wait(rec["id"])
    report, _, _ = _run(fake, corpus)
    assert report.ok and len(report.already_present) == 3 and len(report.uploaded) == 54
    assert len(fake.records) == 57


def test_fallback_to_approving_the_fault_name_when_it_needs_review(corpus):
    def outcome(i):
        o = _outcome(i)
        if i == 11:  # the fault-name fax did not auto-approve after all
            o = {**o, "auto": False, "reasons": ["prior auth: missing prior_imaging"]}
        return o

    fake = FakeApi(outcome=outcome)
    report, _, logs = _run(fake, corpus)
    assert report.ok
    ae = [r for r in fake.records.values() if r["order"]["ack_code"] == "AE"]
    assert len(ae) == 1 and ae[0]["reviews"][-1]["action"] == "approve"
    assert any("fault name" in line for line in logs)


def test_without_ris_control_the_down_step_is_reported_missing(corpus):
    fake = FakeApi()
    report, _, logs = _run(fake, corpus, ris=None)
    assert not report.ok
    missing = [name for name, ok, _ in report.checks if not ok]
    assert missing == ["ris_error from RIS down"]
    assert any("RIS-down step skipped" in line for line in logs)


def test_without_fault_names_the_ae_check_explains_itself(corpus):
    fake = FakeApi(fault=())
    report = seed(_api(fake), corpus, ris=FakeRis(fake), fault_names=[], log=lambda m: None)
    check = next(c for c in report.checks if c[0] == "ris_error from AE")
    assert not check[1] and "RIS_FAULT_LAST_NAMES" in check[2]


def test_health_404_means_the_old_api(corpus):
    with pytest.raises(SeedError, match="old v1 app/main.py"):
        _run(FakeApi(health_404=True), corpus)


def test_unreachable_api(corpus):
    def refuse(request):
        raise httpx.ConnectError("[Errno 61] Connection refused", request=request)

    api = Api(httpx.Client(transport=httpx.MockTransport(refuse), base_url="http://127.0.0.1:8000"),
              retries=2, backoff=0, sleep=lambda s: None)
    with pytest.raises(SeedError, match=r"cannot reach the API at http://127.0.0.1:8000.*api\.log"):
        seed(api, corpus, log=lambda m: None)


def test_every_upload_failing_aborts_early_with_the_error(corpus):
    fake = FakeApi(fail_all=True)
    with pytest.raises(SeedError, match="failed the first 3 uploads.*Lane C implements GraphRunner.start"):
        _run(fake, corpus)
    assert len(fake.uploads) == 3


def test_post_is_not_retried_after_the_request_was_sent(corpus):
    sent = []

    def timeout(request):
        sent.append(request.method)
        raise httpx.ReadTimeout("timed out", request=request)

    api = Api(httpx.Client(transport=httpx.MockTransport(timeout), base_url="http://x"),
              retries=3, backoff=0, sleep=lambda s: None)
    with pytest.raises(SeedError):
        api.upload(corpus / "referral_000.pdf")
    assert sent == ["POST"]  # never doubled
    sent.clear()
    with pytest.raises(SeedError):
        api.get("abcd1234")
    assert sent == ["GET"] * 4  # GETs are retried


def test_api_errors_carry_the_contract_detail():
    def handler(request):
        return httpx.Response(409, json={"detail": "blocking flags remain", "errors": [], "status": "needs_review",
                                         "flags": []})

    api = Api(httpx.Client(transport=httpx.MockTransport(handler), base_url="http://x"), sleep=lambda s: None)
    with pytest.raises(seed_demo.ApiError, match="HTTP 409: blocking flags remain") as err:
        api.approve("abcd1234")
    assert err.value.status == 409


def test_wait_times_out_with_a_pointer_to_the_log():
    def handler(request):
        return httpx.Response(200, json={"id": "abcd1234", "status": "processing", "source_name": "referral_001.pdf"})

    api = Api(httpx.Client(transport=httpx.MockTransport(handler), base_url="http://x"), sleep=lambda s: None)
    with pytest.raises(SeedError, match="still 'processing'.*api.log"):
        api.wait("abcd1234", timeout=0)


def test_pickers():
    recs = []
    for i in range(30):
        o = _outcome(i)
        recs.append({"id": f"{i:08x}", "source_name": f"referral_{i:03d}.pdf",
                     "status": "sent_to_ris" if o["auto"] else "needs_review",
                     "referral": {"patient_last_name": o["last"]}, "flags": o["flags"],
                     "eligibility": {"status": o["elig"]}, "review_reasons": o["reasons"]})
    rej = pick_rejections(recs, 4, avoid=set())
    assert [r["source_name"] for r, _ in rej] == [
        "referral_004.pdf", "referral_010.pdf", "referral_019.pdf", "referral_008.pdf"]
    assert pick_rejections(recs, 2, avoid={r["id"] for r, _ in rej})[0][0]["id"] not in {r["id"] for r, _ in rej}
    # a blocked referral can still be rejected (form category) when nothing else is left
    blocked = [r for r in recs if r["flags"]]
    assert pick_rejections(blocked, 1, set())[0][1].startswith("Referral can't be processed")

    ok = pick_approvals(recs, 10, avoid=set(), fault_names={"name00"})
    ids = {r["id"] for r in ok}
    assert all(not r["flags"] and r["eligibility"]["status"] == "active_in_network" for r in ok)
    assert f"{0:08x}" not in ids and f"{19:08x}" not in ids  # fault name, blocking flag


def test_a_foreign_server_on_the_port_is_refused(corpus):
    def handler(request):
        return httpx.Response(200, json={"status": "ok", "service": "something-else"})

    api = Api(httpx.Client(transport=httpx.MockTransport(handler), base_url="http://127.0.0.1:8000"),
              sleep=lambda s: None)
    with pytest.raises(SeedError, match="not this project's Health"):
        seed(api, corpus, log=lambda m: None)
