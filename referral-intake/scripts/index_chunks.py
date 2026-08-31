"""Build the pgvector library: chunk the policy docs, embed them, insert into Postgres.

Reuses app/rag.py's chunker + embedder. Re-runnable (wipes the table first) and
self-bootstrapping (enables the extension + creates the table on a fresh database).
Run: python -m scripts.index_chunks
"""

from pathlib import Path

from dotenv import load_dotenv

# app.db reads DATABASE_URL at import time, so .env has to land in the environment
# before the import below -- otherwise the engine falls back to its localhost default.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from sqlalchemy import text  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.rag import chunk_policies, embed  # noqa: E402
from app.vectorstore import Chunk  # noqa: E402


def bootstrap():
    """Enable pgvector and create policy_chunks. Both are no-ops once they exist."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)


def run():
    bootstrap()

    session = SessionLocal()
    session.query(Chunk).delete()  # clean slate so re-runs don't duplicate

    chunks = chunk_policies()
    vectors = embed([c["text"] for c in chunks])  # normalized 384-dim

    for c, vec in zip(chunks, vectors):
        session.add(Chunk(
            source=c["source"], payor=c["payor"], cpt=c["cpt"],
            text=c["text"], embedding=vec,
        ))
    session.commit()
    print(f"indexed {len(chunks)} chunks into policy_chunks")


if __name__ == "__main__":
    run()
