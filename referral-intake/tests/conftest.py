"""Shared fixtures. ORCHESTRATOR-OWNED: lanes add fixtures inside their own test
files; ask the orchestrator to change this one.

Database tests need TEST_DATABASE_URL pointing at a Postgres *server* that has
pgvector, e.g. postgresql+psycopg://postgres@127.0.0.1:55433/postgres. Every
test that uses `db` gets a brand-new database (created, init_db'd, dropped after).
Without TEST_DATABASE_URL those tests skip with a loud reason; the QA gate sets
it and requires zero skips.
"""
import json
import os
import socket
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
CORPUS_OUT = ROOT / "corpus" / "out"


def _admin_url():
    url = os.environ.get("TEST_DATABASE_URL", "").strip()
    return url.replace("postgresql+psycopg://", "postgresql://", 1) if url else ""


@pytest.fixture
def db(monkeypatch):
    """A fresh, initialised faxtract-schema database; DATABASE_URL points at it."""
    admin = _admin_url()
    if not admin:
        pytest.skip("TEST_DATABASE_URL not set -- DB test skipped (the QA gate sets it)")
    import psycopg

    from app import db as appdb

    name = f"faxtract_test_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    url = "postgresql+psycopg://" + admin.split("://", 1)[1].rsplit("/", 1)[0] + "/" + name
    monkeypatch.setenv("DATABASE_URL", url)
    appdb.reset_engine()
    appdb.init_db()
    try:
        yield url
    finally:
        appdb.reset_engine()
        with psycopg.connect(admin, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture
def ris_server(tmp_path, monkeypatch):
    """The mock RIS on an ephemeral port with its own order store.
    Sets RIS_MLLP_HOST / RIS_MLLP_PORT / RIS_STORE_PATH for the test."""
    from ris import server as ris

    store = tmp_path / "orders.json"
    monkeypatch.setenv("RIS_STORE_PATH", str(store))
    srv = ris.Server(("127.0.0.1", 0), ris.Handler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    host, port = srv.server_address[:2]
    monkeypatch.setenv("RIS_MLLP_HOST", host)
    monkeypatch.setenv("RIS_MLLP_PORT", str(port))
    try:
        yield {"host": host, "port": port, "store": store}
    finally:
        srv.shutdown()
        srv.server_close()


@pytest.fixture
def ris_down(monkeypatch):
    """RIS_MLLP_* pointing at a port where nothing listens."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    monkeypatch.setenv("RIS_MLLP_HOST", "127.0.0.1")
    monkeypatch.setenv("RIS_MLLP_PORT", str(port))
    return {"host": "127.0.0.1", "port": port}


@pytest.fixture(scope="session")
def corpus():
    """corpus/out with the 60 seed-42 faxes + ground_truth.json (generated once if missing)."""
    truth = CORPUS_OUT / "ground_truth.json"
    if not truth.exists() or len(json.loads(truth.read_text())) < 60:
        subprocess.run([sys.executable, "corpus/generate_faxes.py", "--seed", "42", "--count", "60"],
                       cwd=ROOT, check=True, capture_output=True)
    return CORPUS_OUT
