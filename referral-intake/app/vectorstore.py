"""pgvector-backed storage for the RAG chunks.

Replaces the in-memory NumPy library with a Postgres table (`policy_chunks`) that
holds each chunk's text, metadata, and its 384-dim embedding. The hybrid + 3-step
logic in app/rag.py stays in Python and sits on top of this.
"""

from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, Integer, Text

from app.db import Base, SessionLocal

EMBED_DIM = 384  # all-MiniLM-L6-v2


class Chunk(Base):
    __tablename__ = "policy_chunks"

    id = Column(Integer, primary_key=True)
    source = Column(Text)
    payor = Column(Text)
    cpt = Column(Text)
    text = Column(Text)
    embedding = Column(Vector(EMBED_DIM))


def semantic_candidates(query_text, payor, pool=50):
    """Nearest chunks by cosine, filtered to the payor — the SQL-backed 'semantic + filter' stage.
    Returns a wide candidate pool so the Python keyword re-rank still has room to work."""
    from app.rag import embed  # lazy import to avoid a circular import

    qvec = embed([query_text])[0]
    with SessionLocal() as session:  # context manager returns the connection to the pool
        query = session.query(Chunk, (1 - Chunk.embedding.cosine_distance(qvec)).label("sem"))
        if payor:
            query = query.filter(Chunk.payor.ilike(f"%{payor}%"))
        rows = query.order_by(Chunk.embedding.cosine_distance(qvec)).limit(pool).all()
        return [(chunk, float(sem)) for chunk, sem in rows]
