"""The one-command demo (CONTRACTS section 12). The Makefile drives it:

    make demo        venv + npm ci, then `python -m scripts.demo up`
    make demo-stop   `python -m scripts.demo stop` (services and the demo Postgres)

    python -m scripts.demo up [--keep-going] [--skip-seed]
    python -m scripts.demo stop | status | clean
    python -m scripts.demo pg-up | pg-stop | pg-url
    python -m scripts.demo bootstrap
    python -m scripts.demo test [pytest args...]

`up` runs, in order:
  1. toolchain check: Python >= 3.12, tesseract, poppler (pdftoppm/pdfinfo), node/npm,
     web/node_modules;
  2. database: DATABASE_URL from the environment if it is set (a `.env` file does
     not count here). Otherwise a project-local Postgres: initdb into .demo/pg, TCP-only on
     127.0.0.1:55432, database `faxtract`. The URL is passed to every child process
     explicitly; app code never defaults it;
  3. bootstrap (scripts/bootstrap.py): init_db, index policy chunks, graph.service.setup();
  4. corpus: corpus/build_fixtures.py, then generate_faxes.py --seed 42 --count 60
     (skipped when corpus/out already holds the 60 faxes);
  5. picks the RIS fault name: one seeded fax that auto-approves under replay;
  6. starts the mock RIS on :2575, the API on :8000 (PIPELINE=graph EXTRACTOR=replay
     REPLAY_PACE_S=12) and the web dev server on :5173. Logs go to .demo/logs/<name>.log
     and pids to .demo/run/;
  7. seeds through the HTTP API (scripts/seed_demo.py);
  8. prints the URL to open.

Everything the demo writes lives in .demo/ (which ignores itself). `make demo-clean`
removes it. Stdlib only at import, so `stop` works without the venv.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # referral-intake/
DEMO = ROOT / ".demo"
PGDATA = DEMO / "pg"
LOGS = DEMO / "logs"
RUN = DEMO / "run"
STATE = DEMO / "state.json"
WEB = ROOT / "web"
CORPUS = ROOT / "corpus" / "out"

HOST = "127.0.0.1"
# CONTRACTS section 1 demo defaults. `up --api-port ...` overrides them (e.g. when another
# project holds :8000); the choice is saved in .demo/state.json for stop/status/seed.
DEFAULT_PORTS = {"pg": 55432, "api": 8000, "ris": 2575, "web": 5173}
PG_PORT = API_PORT = RIS_PORT = WEB_PORT = 0
DEMO_DB_URL = API_URL = WEB_URL = ""


def set_ports(pg: int, api: int, ris: int, web: int) -> None:
    global PG_PORT, API_PORT, RIS_PORT, WEB_PORT, DEMO_DB_URL, API_URL, WEB_URL
    PG_PORT, API_PORT, RIS_PORT, WEB_PORT = int(pg), int(api), int(ris), int(web)
    DEMO_DB_URL = f"postgresql+psycopg://postgres@{HOST}:{PG_PORT}/faxtract"
    API_URL = f"http://{HOST}:{API_PORT}"
    WEB_URL = f"http://{HOST}:{WEB_PORT}"


def ports() -> dict:
    return {"pg": PG_PORT, "api": API_PORT, "ris": RIS_PORT, "web": WEB_PORT}


set_ports(**DEFAULT_PORTS)
SERVICES = ("ris", "api", "web")          # start order; stop is the reverse
SERVICE_MARK = {"ris": ("ris.server",), "api": ("uvicorn",), "web": ("npm", "node", "vite")}  # pid sanity check
NOISE = ("Redirects are currently not supported", "Loading weights", "Could not reach the Hub",
         "huggingface/tokenizers")


class DemoError(RuntimeError):
    pass


def say(msg: str = "") -> None:
    print(msg, flush=True)


def ensure_dirs() -> None:
    for d in (DEMO, LOGS, RUN):
        d.mkdir(parents=True, exist_ok=True)
    ignore = DEMO / ".gitignore"
    if not ignore.exists():  # keeps .demo/ out of git without touching the repo's .gitignore
        ignore.write_text("# created by scripts/demo.py: everything here is local demo state\n*\n")


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    ensure_dirs()
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE)


def redact(url: str | None) -> str:
    from scripts.common import redact as _redact
    return _redact(url)


def tail(path: Path, n: int = 25) -> str:
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return f"    ({path} not found)"
    return "\n".join("    | " + line for line in lines[-n:])


# ---------------------------------------------------------------------------
# ports, http, processes
# ---------------------------------------------------------------------------

def port_open(port: int, host: str = HOST) -> bool:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    try:
        with socket.socket(family) as s:
            s.settimeout(0.3)
            return s.connect_ex((host, port)) == 0
    except OSError:
        return False


def who_listens(port: int) -> str:
    lsof = shutil.which("lsof")
    if not lsof:
        return "another process"
    try:
        out = subprocess.run([lsof, "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-Fpc"],
                             capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return "another process"
    pid = next((ln[1:] for ln in out.splitlines() if ln.startswith("p")), None)
    cmd = next((ln[1:] for ln in out.splitlines() if ln.startswith("c")), None)
    return f"pid {pid} ({cmd})" if pid else "another process"


def http_get(url: str, timeout: float = 2.0) -> tuple[int | None, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read(4096).decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(2048).decode(errors="replace")
    except (urllib.error.URLError, OSError) as e:
        return None, str(getattr(e, "reason", e))


def _pidfile(name: str) -> Path:
    return RUN / f"{name}.pid"


def _alive(pid: int) -> bool:
    try:  # reap it if it is our own exited child (the seed restarts the RIS in-process)
        if os.waitpid(pid, os.WNOHANG)[0] == pid:
            return False
    except ChildProcessError:
        pass
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _is_ours(pid: int, name: str) -> bool:
    """Guard against a stale pidfile pointing at a recycled pid."""
    try:
        cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True,
                             text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return True
    return bool(cmd.strip()) and any(mark in cmd for mark in SERVICE_MARK.get(name, ("",)))


def service_pid(name: str) -> int | None:
    try:
        pid = int(_pidfile(name).read_text().strip())
    except (OSError, ValueError):
        return None
    return pid if _alive(pid) and _is_ours(pid, name) else None


def start_service(name: str, spec: dict) -> int:
    ensure_dirs()
    log_path = LOGS / f"{name}.log"
    env = {**os.environ, **spec.get("env", {}), "PYTHONUNBUFFERED": "1"}
    with open(log_path, "ab") as log:
        log.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} starting {name}: "
                  f"{' '.join(spec['cmd'])}\n".encode())
        log.flush()
        proc = subprocess.Popen(spec["cmd"], cwd=spec.get("cwd", str(ROOT)), env=env, stdout=log,
                                stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    _pidfile(name).write_text(str(proc.pid))
    return proc.pid


def stop_service(name: str, timeout: float = 10.0) -> bool:
    pid = service_pid(name)
    _pidfile(name).unlink(missing_ok=True)
    if pid is None:
        return False
    for sig, wait in ((signal.SIGTERM, timeout), (signal.SIGKILL, 3.0)):
        try:
            os.killpg(pid, sig)  # the service is its own session/process group (npm -> node -> vite too)
        except ProcessLookupError:
            return True
        except PermissionError:
            os.kill(pid, sig)
        deadline = time.monotonic() + wait
        while time.monotonic() < deadline:
            if not _alive(pid):
                return True
            time.sleep(0.1)
    return not _alive(pid)


class DemoRisControl:
    """What scripts/seed_demo.py uses to take the RIS down and bring it back."""

    def __init__(self, spec: dict):
        self.spec = spec

    def stop(self) -> None:
        stop_service("ris")
        deadline = time.monotonic() + 10
        while port_open(RIS_PORT) and time.monotonic() < deadline:
            time.sleep(0.1)

    def start(self) -> None:
        start_service("ris", self.spec)
        wait_port(RIS_PORT, 20, "ris")


def ris_control() -> DemoRisControl | None:
    spec = load_state().get("services", {}).get("ris")
    return DemoRisControl(spec) if spec else None


def wait_port(port: int, timeout: float, name: str) -> None:
    deadline = time.monotonic() + timeout
    while not port_open(port):
        if service_pid(name) is None:
            raise DemoError(f"{name} exited before listening on :{port}\n{tail(LOGS / f'{name}.log')}")
        if time.monotonic() > deadline:
            raise DemoError(f"{name} did not listen on :{port} within {timeout:.0f}s\n{tail(LOGS / f'{name}.log')}")
        time.sleep(0.2)


# ---------------------------------------------------------------------------
# Postgres (project-local, TCP-only)
# ---------------------------------------------------------------------------

def pg_bin(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    cands = []
    pg_config = shutil.which("pg_config")
    if pg_config:
        try:
            cands.append(Path(subprocess.run([pg_config, "--bindir"], capture_output=True, text=True,
                                             timeout=5).stdout.strip()) / name)
        except (OSError, subprocess.SubprocessError):
            pass
    cands += [Path(p) / name for p in ("/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin",
                                        "/usr/lib/postgresql/16/bin", "/usr/pgsql-16/bin")]
    for c in cands:
        if c.is_file() and os.access(c, os.X_OK):
            return str(c)
    raise DemoError(f"Postgres binary `{name}` not found. Install Postgres 16 + pgvector "
                    "(macOS: brew install postgresql@16 pgvector; Debian/Ubuntu: apt install "
                    "postgresql-16 postgresql-16-pgvector), or set DATABASE_URL to an existing "
                    "Postgres with pgvector (docker compose up -d db works too).")


def pg_running() -> bool:
    if not (PGDATA / "PG_VERSION").exists():
        return False
    r = subprocess.run([pg_bin("pg_ctl"), "-D", str(PGDATA), "status"], capture_output=True, text=True)
    return r.returncode == 0


def _run_logged(cmd: list[str], log_name: str, **kw) -> subprocess.CompletedProcess:
    ensure_dirs()
    with open(LOGS / log_name, "ab") as log:
        log.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} {' '.join(cmd)}\n".encode())
        log.flush()
        return subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, **kw)


def pg_up() -> str:
    """Start (initialising on first use) the demo Postgres; return the faxtract URL."""
    ensure_dirs()
    if not (PGDATA / "PG_VERSION").exists():
        if PGDATA.exists() and any(PGDATA.iterdir()):
            raise DemoError(f"{PGDATA} exists but is not a Postgres data directory; remove it (make demo-clean)")
        say(f"    initdb {PGDATA.relative_to(ROOT)} (user postgres, trust auth, TCP-only)")
        r = _run_logged([pg_bin("initdb"), "-D", str(PGDATA), "-U", "postgres", "--auth=trust",
                         "--encoding=UTF8", "--no-locale"], "initdb.log")
        if r.returncode:
            raise DemoError(f"initdb failed (exit {r.returncode})\n{tail(LOGS / 'initdb.log')}")
        with open(PGDATA / "postgresql.conf", "a") as conf:
            conf.write("\n# --- scripts/demo.py: project-local demo server, TCP only ---\n"
                       f"listen_addresses = '{HOST}'\nunix_socket_directories = ''\n"
                       "fsync = off\nsynchronous_commit = off\nfull_page_writes = off\n")
    if pg_running() and _pg_running_port() != PG_PORT:
        say(f"    the demo Postgres is running on :{_pg_running_port()}; restarting it on :{PG_PORT}")
        pg_stop()
    if not pg_running():
        if port_open(PG_PORT):
            raise DemoError(f"port {PG_PORT} is already used by {who_listens(PG_PORT)}, not the demo Postgres "
                            f"in {PGDATA}. Stop it, or point DATABASE_URL at it "
                            f"(e.g. DATABASE_URL={DEMO_DB_URL}) so the demo uses that server.")
        r = _run_logged([pg_bin("pg_ctl"), "-D", str(PGDATA), "-l", str(LOGS / "postgres.log"),
                         "-o", f"-p {PG_PORT}", "-w", "-t", "60", "start"], "pg_ctl.log")
        if r.returncode:
            raise DemoError(f"pg_ctl start failed (exit {r.returncode})\n{tail(LOGS / 'postgres.log')}")
    _ensure_database()
    return DEMO_DB_URL


def _pg_running_port() -> int | None:
    try:  # postmaster.pid line 4 is the port
        return int((PGDATA / "postmaster.pid").read_text().splitlines()[3])
    except (OSError, ValueError, IndexError):
        return None


def _ensure_database() -> None:
    try:
        import psycopg
    except ImportError as exc:
        raise DemoError("psycopg is not installed in this Python; run `make demo` (it creates .venv)") from exc
    admin = f"postgresql://postgres@{HOST}:{PG_PORT}/postgres"
    deadline = time.monotonic() + 30
    while True:
        try:
            conn = psycopg.connect(admin, autocommit=True, connect_timeout=3)
            break
        except psycopg.OperationalError as exc:
            if time.monotonic() > deadline:
                raise DemoError(f"demo Postgres on :{PG_PORT} is not accepting connections: {exc}\n"
                                f"{tail(LOGS / 'postgres.log')}") from exc
            time.sleep(0.5)
    with conn:
        if not conn.execute("select 1 from pg_available_extensions where name = 'vector'").fetchone():
            raise DemoError("pgvector is not installed for this Postgres (brew install pgvector / "
                            "apt install postgresql-16-pgvector); the demo needs the `vector` extension")
        if not conn.execute("select 1 from pg_database where datname = 'faxtract'").fetchone():
            conn.execute("create database faxtract")
            say("    created database faxtract")


def pg_stop() -> bool:
    if not pg_running():
        return False
    r = _run_logged([pg_bin("pg_ctl"), "-D", str(PGDATA), "-m", "fast", "-w", "-t", "30", "stop"], "pg_ctl.log")
    return r.returncode == 0


# ---------------------------------------------------------------------------
# the steps
# ---------------------------------------------------------------------------

def check_toolchain() -> None:
    problems = []
    if sys.version_info < (3, 12):
        problems.append(f"Python {sys.version.split()[0]} is too old; 3.12+ is required (PYTHON=python3.12 make demo)")
    if not shutil.which("tesseract"):
        problems.append("tesseract not found (macOS: brew install tesseract; Debian/Ubuntu: apt install tesseract-ocr)")
    poppler = os.environ.get("POPPLER_PATH") or ""
    for tool in ("pdftoppm", "pdfinfo"):
        if not (shutil.which(tool) or (poppler and (Path(poppler) / tool).exists())):
            problems.append(f"{tool} (poppler) not found (macOS: brew install poppler; Debian/Ubuntu: "
                            "apt install poppler-utils; or set POPPLER_PATH to its directory)")
    if not shutil.which("npm"):
        problems.append("npm not found (install Node.js 20+)")
    if not (WEB / "node_modules" / ".bin" / "vite").exists():
        problems.append("web/node_modules is missing: run `make demo` (it runs npm ci) or `cd web && npm ci`")
    if problems:
        raise DemoError("toolchain:\n" + "\n".join(f"    - {p}" for p in problems))
    say(f"    python {sys.version.split()[0]} ({sys.executable}), tesseract, poppler, npm: ok")


def resolve_database(state: dict) -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        state["pg_managed"] = False
        say(f"    DATABASE_URL is set: using {redact(url)} (not starting the demo Postgres)")
        return url
    url = pg_up()
    state["pg_managed"] = True
    say(f"    demo Postgres up: {url}")
    return url


def run_streamed(cmd: list[str], log_name: str, env: dict | None = None, cwd: Path = ROOT) -> int:
    """Run a step, echoing its output (minus model-loading noise) and keeping it all in the log."""
    ensure_dirs()
    full_env = {**os.environ, **(env or {}), "PYTHONUNBUFFERED": "1"}
    with open(LOGS / log_name, "ab") as log:
        log.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} {' '.join(cmd)}\n".encode())
        proc = subprocess.Popen(cmd, cwd=cwd, env=full_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        assert proc.stdout is not None
        for raw in proc.stdout:
            log.write(raw)
            line = raw.decode(errors="replace").rstrip()
            if line and not any(n in line for n in NOISE):
                say("    " + line)
        return proc.wait()


def bootstrap(url: str) -> None:
    rc = run_streamed([sys.executable, "-m", "scripts.bootstrap"], "bootstrap.log", env={"DATABASE_URL": url})
    if rc == 3:
        raise DemoError("graph.service.setup() is not implemented on this branch (Lane C's "
                        "graph/service.py); init_db and the policy index did complete")
    if rc:
        raise DemoError(f"exit {rc}; full output in .demo/logs/bootstrap.log")


def corpus_ready() -> bool:
    truth = CORPUS / "ground_truth.json"
    try:
        names = json.loads(truth.read_text())
    except (OSError, ValueError):
        return False
    return len(names) >= 60 and all((CORPUS / n).exists() for n in names)


def build_corpus() -> None:
    if corpus_ready():
        say("    corpus/out already has the 60 faxes + ground_truth.json (skipped)")
        return
    for cmd in ([sys.executable, "corpus/build_fixtures.py"],
                [sys.executable, "corpus/generate_faxes.py", "--seed", "42", "--count", "60"]):
        rc = _run_logged(cmd, "corpus.log", cwd=ROOT).returncode
        if rc:
            raise DemoError(f"{' '.join(cmd[1:])} failed (exit {rc})\n{tail(LOGS / 'corpus.log')}")
    if not corpus_ready():
        raise DemoError(f"corpus generation finished but {CORPUS} is incomplete\n{tail(LOGS / 'corpus.log')}")
    say("    60 faxes + ground_truth.json written to corpus/out")


def pick_fault(state: dict) -> str:
    from scripts.seed_demo import HOLD_BACK, plan_fault_last_name

    pick = plan_fault_last_name(CORPUS, HOLD_BACK)
    if not pick:
        say("    WARNING: no auto-approving seeded fax with a unique last name; RIS starts without faults")
        state["ris_fault_last_names"] = ""
        return ""
    name, file = pick
    state["ris_fault_last_names"] = name
    say(f"    RIS_FAULT_LAST_NAMES={name} ({file} auto-approves under replay; its ORM will get MSA|AE)")
    return name


def service_specs(db_url: str, fault: str) -> dict:
    py = sys.executable
    ris_env = {"RIS_MLLP_HOST": HOST, "RIS_MLLP_PORT": str(RIS_PORT),
               "RIS_STORE_PATH": str(DEMO / "ris_orders.json")}
    return {
        "ris": {"cmd": [py, "-m", "ris.server"], "cwd": str(ROOT), "port": RIS_PORT,
                "env": {**ris_env, "RIS_FAULT_LAST_NAMES": fault}},
        "api": {"cmd": [py, "-m", "uvicorn", "app.main:app", "--host", HOST, "--port", str(API_PORT)],
                "cwd": str(ROOT), "port": API_PORT,
                "env": {**ris_env, "DATABASE_URL": db_url, "PIPELINE": "graph", "EXTRACTOR": "replay",
                        "REPLAY_PACE_S": "12", "UPLOADS_DIR": str(DEMO / "uploads")}},
        "web": {"cmd": ["npm", "run", "dev", "--", "--host", HOST], "cwd": str(WEB), "port": WEB_PORT,
                "env": {"WEB_PORT": str(WEB_PORT), "API_URL": API_URL}},
    }


def start_services(state: dict, specs: dict) -> list[str]:
    """Start ris, api, web; returns warnings (e.g. an API without /health)."""
    warnings = []
    for name in reversed(SERVICES):
        if stop_service(name):
            say(f"    stopped the previous demo {name}")
    for name in SERVICES:
        port = specs[name]["port"]
        if port_open(port):
            raise DemoError(f"port {port} (for {name}) is in use by {who_listens(port)}. Free it, run "
                            "`make demo-stop` if it is an old demo, or pick another port: "
                            f"make demo DEMO_ARGS='--{name}-port NNNN'")
        if port_open(port, "::1"):
            say(f"    note: [::1]:{port} is taken by {who_listens(port)}; the demo binds {HOST}:{port}, "
                f"so open {HOST} explicitly (\"localhost\" may reach the other server)")
    state["services"] = specs
    save_state(state)

    pid = start_service("ris", specs["ris"])
    wait_port(RIS_PORT, 20, "ris")
    say(f"    ris  pid {pid}  MLLP {HOST}:{RIS_PORT}  (log .demo/logs/ris.log)")

    pid = start_service("api", specs["api"])
    deadline = time.monotonic() + 120
    while True:
        status, body = http_get(f"{API_URL}/health")
        if status == 200:
            say(f"    api  pid {pid}  {API_URL}  /health: {body.strip()[:160]}")
            break
        if status == 404 and http_get(f"{API_URL}/openapi.json")[0] == 200:
            msg = (f"the API is up but GET /health is 404: {API_URL} is still the old v1 app/main.py "
                   "(Lane A's CONTRACTS section 5 API is not on this branch)")
            warnings.append(msg)
            say(f"    api  pid {pid}  {API_URL}  WARNING: {msg}")
            break
        if service_pid("api") is None:
            raise DemoError(f"the API exited during startup\n{tail(LOGS / 'api.log', 40)}")
        if time.monotonic() > deadline:
            raise DemoError(f"the API did not answer {API_URL}/health within 120s (last: {status} {body[:120]})\n"
                            f"{tail(LOGS / 'api.log', 40)}")
        time.sleep(0.5)

    pid = start_service("web", specs["web"])
    deadline = time.monotonic() + 90
    while True:
        status, _ = http_get(f"{WEB_URL}/", timeout=3)
        if status == 200:
            proxied, _ = http_get(f"{WEB_URL}/api/health", timeout=5)
            say(f"    web  pid {pid}  {WEB_URL}  (/api proxy -> {API_URL}: HTTP {proxied})")
            break
        if service_pid("web") is None:
            raise DemoError(f"the web dev server exited during startup\n{tail(LOGS / 'web.log', 40)}")
        if time.monotonic() > deadline:
            raise DemoError(f"the web dev server did not answer {WEB_URL} within 90s\n{tail(LOGS / 'web.log', 40)}")
        time.sleep(0.5)
    return warnings


def run_seed(state: dict) -> None:
    import httpx

    from scripts import seed_demo

    spec = state.get("services", {}).get("ris")
    with httpx.Client(base_url=API_URL, timeout=httpx.Timeout(60.0, connect=5.0)) as client:
        try:
            report = seed_demo.seed(seed_demo.Api(client), CORPUS, ris=DemoRisControl(spec) if spec else None,
                                    fault_names=(state.get("ris_fault_last_names") or "").split(","),
                                    log=lambda m: say("    " + m if m else ""))
        except seed_demo.SeedError as exc:
            raise DemoError(str(exc)) from exc
    if not report.ok:
        missing = [name for name, ok, _ in report.checks if not ok]
        raise DemoError(f"seed finished but the demo mix is incomplete: {', '.join(missing)}")


def cmd_up(args) -> int:
    ensure_dirs()
    state = load_state()
    state["ports"] = ports()
    if ports() != DEFAULT_PORTS:
        say(f"ports (non-default): {ports()}")
    failures: list[str] = []
    t_all = time.monotonic()
    steps = [
        ("toolchain", lambda: check_toolchain()),
        ("database", lambda: state.__setitem__("database_url", resolve_database(state))),
        ("bootstrap", lambda: bootstrap(state["database_url"])),
        ("corpus", build_corpus),
        ("RIS fault pick", lambda: pick_fault(state)),
        ("services", lambda: failures.extend(
            start_services(state, service_specs(state["database_url"], state.get("ris_fault_last_names", ""))))),
        ("seed", (lambda: say("    skipped (--skip-seed)")) if args.skip_seed else (lambda: run_seed(state))),
    ]
    for i, (name, fn) in enumerate(steps, 1):
        say(f"[{i}/{len(steps) + 1}] {name}")
        t = time.monotonic()
        try:
            fn()
        except DemoError as exc:
            failures.append(f"{name}: {exc}")
            say(f"    FAILED: {exc}")
            hard = name in ("toolchain", "database")  # nothing after these can work
            if not args.keep_going or hard:
                break
        except KeyboardInterrupt:
            say("\ninterrupted; `make demo-stop` stops anything that was started")
            return 130
        finally:
            save_state(state)
        say(f"    ({time.monotonic() - t:.1f}s)")

    say(f"[{len(steps) + 1}/{len(steps) + 1}] summary ({time.monotonic() - t_all:.0f}s)")
    running = [n for n in SERVICES if service_pid(n)]
    try:
        if pg_running():
            running.append(f"postgres :{PG_PORT}")
    except DemoError:
        pass
    if running:
        say(f"    running: {', '.join(running)}   logs: .demo/logs/   stop: make demo-stop")
    if "web" in running:
        say(f"    open {WEB_URL}/queue   (API {API_URL}/docs)")
    if failures:
        say("")
        say("DEMO INCOMPLETE:")
        for f in failures:
            say("  - " + f.splitlines()[0])
        if not args.keep_going:
            say("  (re-run with `make demo DEMO_ARGS=--keep-going` to run every step and list all failures)")
        return 1
    say("")
    say(f"Demo is up. Open {WEB_URL}/queue")
    return 0


def cmd_stop(_args) -> int:
    any_stopped = False
    for name in reversed(SERVICES):
        if stop_service(name):
            say(f"stopped {name}")
            any_stopped = True
    try:
        if pg_stop():
            say(f"stopped the demo Postgres ({PGDATA.relative_to(ROOT)}, :{PG_PORT})")
            any_stopped = True
    except DemoError as exc:  # no pg_ctl on PATH: nothing of ours can be running
        say(f"(postgres: {exc.args[0].splitlines()[0]})")
    for name, port in (("ris", RIS_PORT), ("api", API_PORT), ("web", WEB_PORT)):
        if port_open(port):
            say(f"note: port {port} ({name}) is still in use by {who_listens(port)}, which the demo did not start")
    if not any_stopped:
        say("nothing from the demo was running")
    return 0


def cmd_status(_args) -> int:
    state = load_state()
    for name in SERVICES:
        pid = service_pid(name)
        port = {"ris": RIS_PORT, "api": API_PORT, "web": WEB_PORT}[name]
        say(f"{name:9s} {'running pid ' + str(pid) if pid else 'stopped':22s} port {port} "
            f"{'open' if port_open(port) else 'closed'}")
    try:
        pg = pg_running()
    except DemoError:
        pg = False
    say(f"{'postgres':9s} {'running' if pg else 'stopped':22s} port {PG_PORT} ({PGDATA.relative_to(ROOT)})")
    if state.get("database_url"):
        say(f"database  {redact(state['database_url'])}")
    if state.get("ris_fault_last_names"):
        say(f"RIS_FAULT_LAST_NAMES={state['ris_fault_last_names']}")
    return 0


def cmd_clean(args) -> int:
    """Stop everything, then delete .demo/ (only that directory, after checking what it is)."""
    cmd_stop(args)
    target = DEMO.resolve()
    if target.name != ".demo" or target.parent != ROOT.resolve() or not (ROOT / "pyproject.toml").exists():
        raise DemoError(f"refusing to delete {target}: not referral-intake/.demo")
    if not target.exists():
        say("nothing to clean")
        return 0
    if pg_running():
        raise DemoError("the demo Postgres is still running; not deleting its data directory")
    shutil.rmtree(target)
    say(f"deleted {target.relative_to(ROOT.resolve())}/ (demo database, logs, uploads, RIS orders)")
    return 0


def cmd_pg_up(_args) -> int:
    say(pg_up())
    return 0


def cmd_pg_stop(_args) -> int:
    say("stopped" if pg_stop() else "not running")
    return 0


def cmd_pg_url(_args) -> int:
    print(DEMO_DB_URL)
    return 0


def cmd_bootstrap(_args) -> int:
    url = os.environ.get("DATABASE_URL", "").strip() or pg_up()
    say(f"bootstrap against {redact(url)}")
    bootstrap(url)
    return 0


def cmd_test(args) -> int:
    url = os.environ.get("TEST_DATABASE_URL", "").strip()
    started = False
    if not url:
        started = not pg_running()
        pg_up()
        url = f"postgresql+psycopg://postgres@{HOST}:{PG_PORT}/postgres"
    say(f"TEST_DATABASE_URL={redact(url)}")
    try:
        rc = subprocess.call([sys.executable, "-m", "pytest", *args.pytest_args], cwd=ROOT,
                             env={**os.environ, "TEST_DATABASE_URL": url})
    finally:
        if started:
            pg_stop()
            say("stopped the demo Postgres again (it was not running before `make test`)")
    return rc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m scripts.demo", description="faxtract demo runner")
    sub = ap.add_subparsers(dest="cmd", required=True)
    up = sub.add_parser("up", help="bring up DB + bootstrap + corpus + RIS/API/web + seed")
    up.add_argument("--keep-going", action="store_true", help="run every step even after a failure")
    up.add_argument("--skip-seed", action="store_true")
    for name in ("api", "web", "ris", "pg"):
        up.add_argument(f"--{name}-port", type=int, default=None,
                        help=f"default {DEFAULT_PORTS[name]} (CONTRACTS section 1)")
    sub.add_parser("stop", help="stop the services and the demo Postgres")
    sub.add_parser("status")
    sub.add_parser("clean", help="stop, then delete .demo/")
    sub.add_parser("pg-up", help="start the demo Postgres (initdb on first use)")
    sub.add_parser("pg-stop")
    sub.add_parser("pg-url")
    sub.add_parser("bootstrap", help="bootstrap DATABASE_URL, or the demo Postgres if unset")
    t = sub.add_parser("test", help="pytest against TEST_DATABASE_URL, or the demo Postgres")
    t.add_argument("pytest_args", nargs=argparse.REMAINDER)
    args = ap.parse_args(argv)
    state = load_state()
    chosen = {**DEFAULT_PORTS, **state.get("ports", {})}
    if args.cmd == "up":
        chosen = dict(DEFAULT_PORTS)
        chosen.update({k: getattr(args, f"{k}_port") for k in DEFAULT_PORTS if getattr(args, f"{k}_port")})
    set_ports(**chosen)
    fn = {"up": cmd_up, "stop": cmd_stop, "status": cmd_status, "clean": cmd_clean, "pg-up": cmd_pg_up, "pg-stop": cmd_pg_stop,
          "pg-url": cmd_pg_url, "bootstrap": cmd_bootstrap, "test": cmd_test}[args.cmd]
    try:
        return fn(args)
    except DemoError as exc:
        print(f"demo: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    if __package__ in (None, ""):
        sys.path.insert(0, str(ROOT))
    sys.exit(main())
