"""scripts/demo.py (the make demo runner) and the seed's RIS fault pick.

The full `make demo` (initdb, servers, browser) is verified from a fresh clone;
these cover the parts that decide what the demo does.
"""
import json
import sys
import time

import pytest

from scripts import demo
from scripts.seed_demo import HOLD_BACK, plan_fault_last_name


@pytest.fixture
def demo_dirs(tmp_path, monkeypatch):
    """Point the runner's state/log/pid directories at a temp dir."""
    d = tmp_path / ".demo"
    for name, path in {"DEMO": d, "LOGS": d / "logs", "RUN": d / "run", "STATE": d / "state.json",
                       "PGDATA": d / "pg"}.items():
        monkeypatch.setattr(demo, name, path)
    yield d
    demo.set_ports(**demo.DEFAULT_PORTS)


def test_fault_pick_is_an_auto_approving_seeded_fax(corpus):
    from app.auth_packet import auth_requirement
    from app.edi import build_270, parse_271
    from app.extract_replay import extract as replay
    from app.gate import review_reasons
    from app.payor import respond
    from app.pipeline import CLINIC_NPI
    from app.validate import validate

    pick = plan_fault_last_name(corpus, HOLD_BACK)
    assert pick is not None
    name, file = pick
    assert pick == plan_fault_last_name(corpus, HOLD_BACK)  # deterministic
    assert file.removesuffix(".pdf") not in HOLD_BACK

    ref, _ = replay(corpus / file)
    assert ref.patient_last_name == name
    elig = parse_271(respond(build_270(ref, CLINIC_NPI)))
    assert review_reasons(validate(ref, 0.85), elig, auth_requirement(ref)) == []  # auto-approves -> sent -> AE

    truth = json.loads((corpus / "ground_truth.json").read_text())
    held_names = set()
    for h in HOLD_BACK:
        held_names.add(truth[f"{h}.pdf"]["patient_last_name"].lower())
        held_names.add((replay(corpus / f"{h}.pdf")[0].patient_last_name or "").lower())
    assert name.lower() not in held_names  # the live demo's approve must still get AA


def test_service_specs_follow_the_demo_contract(demo_dirs):
    specs = demo.service_specs("postgresql+psycopg://postgres@127.0.0.1:55432/faxtract", "Petrov")
    api, ris, web = specs["api"], specs["ris"], specs["web"]
    assert api["env"]["DATABASE_URL"] == "postgresql+psycopg://postgres@127.0.0.1:55432/faxtract"
    assert (api["env"]["PIPELINE"], api["env"]["EXTRACTOR"], api["env"]["REPLAY_PACE_S"]) == ("graph", "replay", "12")
    assert api["cmd"][-4:] == ["--host", "127.0.0.1", "--port", "8000"] and "app.main:app" in api["cmd"]
    assert ris["env"]["RIS_FAULT_LAST_NAMES"] == "Petrov"
    for spec in (api, ris):
        assert (spec["env"]["RIS_MLLP_HOST"], spec["env"]["RIS_MLLP_PORT"]) == ("127.0.0.1", "2575")
        assert spec["env"]["RIS_STORE_PATH"] == str(demo_dirs / "ris_orders.json")  # API's in_ris == RIS store
    assert api["env"]["UPLOADS_DIR"] == str(demo_dirs / "uploads")
    assert web["cmd"][:3] == ["npm", "run", "dev"] and web["env"] == {"WEB_PORT": "5173", "API_URL": "http://127.0.0.1:8000"}
    # every env var the demo sets for the Python services is a CONTRACTS section 3 variable
    from tests.test_setup_env import CONTRACT_VARS

    assert set(api["env"]) | set(ris["env"]) <= set(CONTRACT_VARS)


def test_port_overrides(demo_dirs):
    demo.set_ports(pg=55440, api=8090, ris=2590, web=5190)
    specs = demo.service_specs(demo.DEMO_DB_URL, "")
    assert demo.DEMO_DB_URL.endswith(":55440/faxtract")
    assert specs["api"]["cmd"][-1] == "8090" and specs["web"]["env"]["API_URL"] == "http://127.0.0.1:8090"
    assert specs["ris"]["env"]["RIS_MLLP_PORT"] == "2590" == specs["api"]["env"]["RIS_MLLP_PORT"]
    assert demo.ports() == {"pg": 55440, "api": 8090, "ris": 2590, "web": 5190}


def test_demo_dir_ignores_itself(demo_dirs):
    demo.ensure_dirs()
    assert (demo_dirs / ".gitignore").read_text().splitlines()[-1] == "*"
    demo.save_state({"x": 1})
    assert demo.load_state() == {"x": 1}


def test_corpus_ready(tmp_path, monkeypatch):
    import os

    monkeypatch.setattr(demo, "CORPUS", tmp_path)
    root = tmp_path / "root"
    (root / "corpus" / "fixtures").mkdir(parents=True)
    gen = root / "corpus" / "generate_faxes.py"
    gen.write_text("# generator")
    os.utime(gen, (1_000_000, 1_000_000))
    monkeypatch.setattr(demo, "ROOT", root)
    assert not demo.corpus_ready()
    names = {f"referral_{i:03d}.pdf": {} for i in range(60)}
    (tmp_path / "ground_truth.json").write_text(json.dumps(names))
    assert not demo.corpus_ready()  # truth without PDFs
    for n in names:
        (tmp_path / n).write_bytes(b"%PDF")
    assert demo.corpus_ready()
    gen.write_text("# generator, changed")  # newer than ground_truth.json -> regenerate
    assert not demo.corpus_ready()


def test_start_and_stop_a_service(demo_dirs):
    # the command line carries the service mark ("ris.server") the pid check looks for
    spec = {"cmd": [sys.executable, "-c", "import time  # ris.server\ntime.sleep(60)"], "env": {"RIS_MLLP_PORT": "1"}}
    pid = demo.start_service("ris", spec)
    try:
        deadline = time.monotonic() + 5
        while demo.service_pid("ris") is None and time.monotonic() < deadline:
            time.sleep(0.05)
        assert demo.service_pid("ris") == pid
        assert demo.stop_service("ris", timeout=5)
        assert demo.service_pid("ris") is None and not demo._alive(pid)
        assert not (demo_dirs / "run" / "ris.pid").exists()
        assert "starting ris" in (demo_dirs / "logs" / "ris.log").read_text()
    finally:
        if demo._alive(pid):
            demo.os.kill(pid, 9)


def test_stale_pidfile_is_not_killed(demo_dirs):
    import os

    demo.ensure_dirs()
    (demo_dirs / "run" / "api.pid").write_text(str(os.getpid()))  # pytest itself: not a uvicorn process
    assert demo.service_pid("api") is None
    assert demo.stop_service("api") is False
    assert demo._alive(os.getpid())


def test_stop_with_nothing_running(demo_dirs, capsys):
    assert demo.main(["stop"]) == 0
    assert "nothing from the demo was running" in capsys.readouterr().out


def test_clean_refuses_a_foreign_directory(demo_dirs, monkeypatch, tmp_path):
    monkeypatch.setattr(demo, "DEMO", tmp_path / "not-demo")
    (tmp_path / "not-demo").mkdir()
    with pytest.raises(demo.DemoError, match="refusing to delete"):
        demo.cmd_clean(None)
    assert (tmp_path / "not-demo").exists()


def test_database_url_from_environment_is_used_as_is(demo_dirs, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://me:secret@db.example:5432/faxtract")
    state = {}
    assert demo.resolve_database(state) == "postgresql+psycopg://me:secret@db.example:5432/faxtract"
    assert state["pg_managed"] is False
    out = capsys.readouterr().out
    assert "secret" not in out and "me:***@" in out
