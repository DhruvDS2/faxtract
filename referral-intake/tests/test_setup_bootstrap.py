"""scripts/bootstrap.py + scripts/index_chunks.py: idempotent, re-runnable, loud on failure.

The embedder is replaced by a deterministic fake (no model load, no network) and
graph.service.setup by a counter: the real one belongs to Lane C, and these
tests are about the bootstrap's own guarantees.
"""
import hashlib
import socket

import numpy as np
import pytest
from sqlalchemy import func, inspect, select, text

from app import db as appdb
from app import rag
from app.vectorstore import EMBED_DIM, Chunk
from scripts import bootstrap as boot
from scripts import index_chunks
from scripts.common import explain_db_error, redact

quiet = lambda *_: None  # noqa: E731


def _fake_vec(text_: str) -> np.ndarray:
    seed = int.from_bytes(hashlib.sha256(text_.encode()).digest()[:8], "big")
    v = np.random.default_rng(seed).normal(size=EMBED_DIM)
    return v / np.linalg.norm(v)


@pytest.fixture
def calls(monkeypatch):
    calls = {"embed": 0, "embedded": 0, "setup": 0}

    def embed(texts):
        texts = list(texts)
        calls["embed"] += 1
        calls["embedded"] += len(texts)
        return np.array([_fake_vec(t) for t in texts])

    def setup():
        calls["setup"] += 1

    from graph import service

    monkeypatch.setattr(rag, "embed", embed)
    monkeypatch.setattr(service, "setup", setup)
    return calls


def _rows():
    with appdb.get_engine().connect() as conn:
        return conn.execute(select(func.count()).select_from(Chunk)).scalar()


def test_bootstrap_is_idempotent(db, calls):
    expected = len(rag.chunk_policies())
    assert expected > 100  # 24 policy docs, ~9 chunks each

    first = boot.bootstrap(log=quiet)
    assert first["index"]["action"] == "indexed"
    assert _rows() == expected
    assert {"policy_chunks", "trace_events"} <= set(first["tables"])
    assert calls == {"embed": 1, "embedded": expected, "setup": 1}

    second = boot.bootstrap(log=quiet)
    assert second["index"]["action"] == "current"
    assert _rows() == expected  # no duplicates
    assert calls["embed"] == 1  # nothing re-embedded
    assert calls["setup"] == 2  # setup is called every time (it is idempotent itself)

    with appdb.get_engine().connect() as conn:
        assert conn.execute(text("select 1 from pg_extension where extname = 'vector'")).scalar() == 1
        dims = conn.execute(text("select vector_dims(embedding) from policy_chunks limit 1")).scalar()
        nulls = conn.execute(select(func.count()).select_from(Chunk).where(Chunk.embedding.is_(None))).scalar()
    assert dims == EMBED_DIM and nulls == 0


def test_embeddings_are_stored_per_chunk(db, calls):
    boot.bootstrap(log=quiet)
    chunk = rag.chunk_policies()[5]
    with appdb.SessionLocal() as s:
        row = s.execute(select(Chunk).where(Chunk.text == chunk["text"])).scalars().one()
        assert (row.source, row.payor, row.cpt) == (chunk["source"], chunk["payor"], chunk["cpt"])
        assert np.allclose(np.array(row.embedding), _fake_vec(chunk["text"]), atol=1e-6)


def test_index_follows_policy_changes(db, calls, monkeypatch):
    full = rag.chunk_policies()
    index_chunks.run(log=quiet)
    monkeypatch.setattr(rag, "chunk_policies", lambda: full[:10])
    assert index_chunks.run(log=quiet)["action"] == "indexed"
    assert _rows() == 10
    edited = [dict(c) for c in full[:10]]
    edited[3]["text"] += " (revised)"
    monkeypatch.setattr(rag, "chunk_policies", lambda: edited)
    assert index_chunks.run(log=quiet)["action"] == "indexed"  # same count, different text
    monkeypatch.setattr(rag, "chunk_policies", lambda: full)
    assert index_chunks.run(log=quiet)["action"] == "indexed"
    assert _rows() == len(full)
    assert index_chunks.run(log=quiet)["action"] == "current"


def test_index_force_reembeds(db, calls):
    index_chunks.run(log=quiet)
    n = _rows()
    assert index_chunks.run(force=True, log=quiet)["action"] == "indexed"
    assert _rows() == n and calls["embed"] == 2


def test_index_repairs_missing_embeddings(db, calls):
    index_chunks.run(log=quiet)
    with appdb.get_engine().begin() as conn:
        conn.execute(text("update policy_chunks set embedding = null where id in (select id from policy_chunks limit 3)"))
    assert index_chunks.run(log=quiet)["action"] == "indexed"


def test_failed_embed_leaves_table_intact(db, calls, monkeypatch):
    index_chunks.run(log=quiet)
    n = _rows()

    def broken(texts):
        raise RuntimeError("model download failed")

    monkeypatch.setattr(rag, "embed", broken)
    monkeypatch.setattr(rag, "chunk_policies", lambda: [{"source": "x", "payor": "y", "cpt": None, "text": "z"}])
    with pytest.raises(RuntimeError, match="model download failed"):
        index_chunks.run(log=quiet)
    assert _rows() == n  # the old rows survive: replace happens in one transaction


def test_missing_graph_setup_is_reported_after_steps_1_and_2(db, calls, monkeypatch):
    from graph import service

    def not_yet():
        raise NotImplementedError("Lane C implements graph.service.setup()")

    monkeypatch.setattr(service, "setup", not_yet)
    with pytest.raises(boot.BootstrapError) as err:
        boot.bootstrap(log=quiet)
    assert err.value.code == 3 and err.value.step == "graph.service.setup"
    assert "NOT created" in str(err.value)
    assert _rows() == len(rag.chunk_policies())  # index still done
    assert "policy_chunks" in inspect(appdb.get_engine()).get_table_names()


def test_main_without_database_url(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(boot, "load_env", lambda: None)  # ignore a developer's .env
    appdb.reset_engine()
    assert boot.main([]) == 2
    assert "DATABASE_URL is not set" in capsys.readouterr().err


def test_unreachable_database_is_explained_without_the_password(monkeypatch):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    url = f"postgresql+psycopg://postgres:hunter2@127.0.0.1:{port}/faxtract"
    monkeypatch.setenv("DATABASE_URL", url)
    appdb.reset_engine()
    try:
        with pytest.raises(boot.BootstrapError) as err:
            boot.bootstrap(log=quiet)
    finally:
        appdb.reset_engine()
    assert err.value.code == 2 and err.value.step == "init_db"
    msg = str(err.value)
    assert "cannot connect to Postgres" in msg and "hunter2" not in msg and ":***@" in msg


def test_redact_and_explain():
    assert redact("postgresql+psycopg://u:p%40ss@h:5/db") == "postgresql+psycopg://u:***@h:5/db"
    assert redact("postgresql://u@h/db") == "postgresql://u@h/db"
    assert redact(None) == "<unset>"
    assert "pgvector is not installed" in explain_db_error(
        RuntimeError('extension "vector" is not available'), "postgresql://u@h/db")
    assert "Create it" in explain_db_error(
        RuntimeError('connection failed: FATAL:  database "faxtract" does not exist'), "postgresql://u@h/db")
