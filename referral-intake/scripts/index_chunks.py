"""Build the pgvector library: chunk the policy docs, embed them, insert into Postgres.

Reuses app/rag.py's chunker + embedder. Re-runnable (wipes the table first).
Run: python -m scripts.index_chunks
"""

from app.db import SessionLocal
from app.rag import chunk_policies, embed
from app.vectorstore import Chunk


def run():
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
