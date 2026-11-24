"""Postgres access. DATABASE_URL is required; there is deliberately no default.

One database holds everything: pgvector policy chunks, referral records,
reviewer corrections, trace events and the LangGraph checkpointer. The
project's database is named `faxtract` everywhere (docs, .env.example, demo).

DATABASE_URL may be written as postgresql://... or postgresql+psycopg://...;
both use psycopg 3. libpq_url() gives the plain form psycopg and the LangGraph
checkpointer want.
"""
import importlib
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

DB_NAME = "faxtract"

Base = declarative_base()

# Every module that declares tables on Base. init_db() imports them so
# create_all sees the whole schema.
MODEL_MODULES = ("app.vectorstore", "app.trace", "app.store")

_engine = None
_sessionmaker = None


class DatabaseNotConfigured(RuntimeError):
    pass


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise DatabaseNotConfigured(
            "DATABASE_URL is not set. There is no default on purpose: point it at "
            "the faxtract database, e.g. postgresql+psycopg://postgres@127.0.0.1:55432/faxtract "
            "(make demo starts one for you)."
        )
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def libpq_url() -> str:
    """DATABASE_URL without the SQLAlchemy driver suffix, for psycopg/LangGraph."""
    rest = database_url().split("://", 1)[1]
    return "postgresql://" + rest


def get_engine():
    global _engine, _sessionmaker
    if _engine is None:
        _engine = create_engine(database_url(), pool_pre_ping=True)
        _sessionmaker = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def SessionLocal():  # noqa: N802 -- kept call-compatible with the old sessionmaker name
    get_engine()
    return _sessionmaker()


def reset_engine():
    """Drop the cached engine (tests switch DATABASE_URL between databases)."""
    global _engine, _sessionmaker
    if _engine is not None:
        _engine.dispose()
    _engine = _sessionmaker = None


def init_db():
    """Enable pgvector and create every table. Idempotent."""
    for module in MODEL_MODULES:
        importlib.import_module(module)
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)


def ping() -> bool:
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
