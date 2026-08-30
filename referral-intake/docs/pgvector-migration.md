# Adding a real vector database to faxtract (pgvector)

Reference for migrating the RAG retriever from the in-memory NumPy array to **pgvector**,
while keeping the local MiniLM embeddings + hybrid + 3-step design intact.

## Why pgvector (not OpenAI's vector store)
- **OpenAI Vector Store** uses *OpenAI's* embeddings and does *its own* retrieval → you'd throw
  away your local MiniLM embeddings AND your hybrid/3-step logic. Wrong fit for a custom retriever.
- **pgvector** = Postgres is already in the stack. Keep your own embeddings + hybrid + 3-step;
  just swap the NumPy brute-force + Python payor filter for SQL. **Recommended.**
- **Chroma** = fastest local drop-in if you want zero infra. **Pinecone/Weaviate** = overkill here.

> Honest note: at ~216 chunks the NumPy version is already instant. This is a
> **learning / portfolio / future-scale** upgrade, not a performance fix.

## Steps

**0. Install**
```bash
pip install pgvector sentence-transformers sqlalchemy psycopg2-binary
```
Reuse your existing SQLAlchemy `engine` / `SessionLocal` / `Base` (in `app/db.py`).

**1. Enable the extension (once per DB)**
```python
from sqlalchemy import text
from app.db import engine
with engine.begin() as conn:
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
```
(Managed hosts: enable "vector" in their extensions panel.)

**2. Define the table (SQLAlchemy model)**
```python
from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, Integer, Text, ARRAY
from app.db import Base

class Chunk(Base):
    __tablename__ = "chunks"
    id        = Column(Integer, primary_key=True)
    source    = Column(Text)
    payor     = Column(Text)
    cpt       = Column(ARRAY(Text))
    text      = Column(Text)
    embedding = Column(Vector(384))   # 384 = MiniLM dimension
```
Create it: `Base.metadata.create_all(engine)`.

**3. One-time indexing script** (`scripts/index_chunks.py`) — reuse the existing chunker, redirect
output from "append to NumPy array" to "insert rows".
```python
from sentence_transformers import SentenceTransformer
from app.db import SessionLocal
from app.models import Chunk

model = SentenceTransformer("all-MiniLM-L6-v2")

def run():
    session = SessionLocal()
    session.query(Chunk).delete()                 # clean slate, no dupes on re-run
    chunks = load_and_chunk_documents()           # existing chunker
    vectors = model.encode([c.text for c in chunks], normalize_embeddings=True, batch_size=32)
    for c, vec in zip(chunks, vectors):
        session.add(Chunk(source=c.source, payor=c.payor, cpt=c.cpt_codes, text=c.text, embedding=vec))
    session.commit()
```
Verify: `SELECT count(*), payor FROM chunks GROUP BY payor;` → ~216 rows.

**4. ANN index** (cosine, since vectors are normalized)
```sql
CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
```

**5. Swap the retrieval core in `rag.py`** — return a WIDE candidate pool (not final k):
```python
def semantic_candidates(query, payor, pool=50):
    qvec = model.encode(query, normalize_embeddings=True)
    sql = text("""
        SELECT id, text, cpt, source, 1 - (embedding <=> :qvec) AS semantic_score
        FROM chunks
        WHERE (:payor IS NULL OR payor = :payor)
        ORDER BY embedding <=> :qvec
        LIMIT :pool
    """)
    return SessionLocal().execute(sql, {"qvec": qvec.tolist(), "payor": payor, "pool": pool}).mappings().all()
```
`<=>` = cosine distance (smaller = closer); `1 - distance` = similarity. Payor filter now in SQL.

**6. Keep the hybrid + 3-step ON TOP (unchanged)** — consume `semantic_candidates()`:
```python
def hybrid_retrieve(query, payor, k=8):
    cands = semantic_candidates(query, payor, pool=50)
    for c in cands:
        c["keyword_score"] = keyword_cpt_icd_score(query, c["cpt"])
    minmax(cands, "semantic_score"); minmax(cands, "keyword_score")
    for c in cands:
        c["final"] = w_sem*c["semantic_score"] + w_kw*c["keyword_score"]
    return sorted(cands, key=lambda c: c["final"], reverse=True)[:k]
```
The 3-step wrapper doesn't change — it just calls `hybrid_retrieve` instead of the old NumPy retriever.

**7. Parity check** — run queries through old (NumPy) and new (SQL) paths, confirm top results match,
then delete the NumPy path.

## Two gotchas
- Keep `normalize_embeddings=True` **everywhere** (indexing AND query) or cosine scores drift.
- Fetch a **pool wider than k** in SQL so the keyword re-rank actually has room to change the order.
