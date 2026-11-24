"""Index the payor policy library into pgvector (table policy_chunks). Re-runnable.

    python -m scripts.index_chunks [--force]

1. Loads referral-intake/.env (real environment variables win). DATABASE_URL is
   required; there is no default.
2. app.db.init_db(): the vector extension and every table.
3. Chunks corpus/policies/*.md with app.rag.chunk_policies(). If policy_chunks
   already holds exactly those chunks, with embeddings, it stops there.
   Otherwise it embeds them (all-MiniLM-L6-v2, 384-dim, normalised) and
   replaces the table's rows in one transaction, so readers never see a
   half-built table. A Postgres advisory lock keeps two runs from interleaving.

The first run downloads the embedding model (~90 MB) unless it is cached; set
HF_HUB_OFFLINE=1 once it is.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

if __package__ in (None, ""):  # `python scripts/index_chunks.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.common import ensure_importable, explain_db_error, load_env, redact  # noqa: E402

ensure_importable()

LOCK_KEY = 0x66617874  # "faxt": pg_advisory_xact_lock key for this job


def fingerprint(rows) -> str:
    """Order-independent hash of (source, payor, cpt, text) tuples."""
    canon = sorted(json.dumps([r[0], r[1], r[2], r[3]]) for r in rows)
    return hashlib.sha256("\n".join(canon).encode()).hexdigest()


def run(force: bool = False, log=print) -> dict:
    """Make policy_chunks match corpus/policies. Returns a summary dict."""
    from sqlalchemy import delete, func, insert, select, text

    from app import rag
    from app.db import get_engine, init_db
    from app.vectorstore import EMBED_DIM, Chunk

    t0 = time.perf_counter()
    init_db()
    chunks = rag.chunk_policies()
    if not chunks:
        from app.policy import POLICY_DIR
        raise RuntimeError(f"no policy chunks: {POLICY_DIR}/*.md is empty or missing")
    wanted = [(c["source"], c["payor"], c["cpt"], c["text"]) for c in chunks]
    docs = len({c["source"] for c in chunks})
    summary = {"chunks": len(chunks), "docs": docs}

    with get_engine().begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": LOCK_KEY})
        have = conn.execute(select(Chunk.source, Chunk.payor, Chunk.cpt, Chunk.text)).all()
        unembedded = conn.execute(
            select(func.count()).select_from(Chunk).where(Chunk.embedding.is_(None))).scalar()
        if not force and not unembedded and len(have) == len(wanted) \
                and fingerprint(have) == fingerprint(wanted):
            summary |= {"action": "current", "seconds": round(time.perf_counter() - t0, 2)}
            log(f"policy_chunks already current: {len(chunks)} chunks from {docs} docs (nothing to do)")
            return summary

        log(f"embedding {len(chunks)} chunks from {docs} policy docs (all-MiniLM-L6-v2)...")
        vectors = rag.embed([c["text"] for c in chunks])
        if len(vectors) != len(chunks) or len(vectors[0]) != EMBED_DIM:
            raise RuntimeError(f"embedder returned {len(vectors)}x{len(vectors[0])}, "
                               f"expected {len(chunks)}x{EMBED_DIM}")
        conn.execute(delete(Chunk))
        conn.execute(insert(Chunk), [
            {"source": s, "payor": p, "cpt": cpt, "text": t, "embedding": [float(x) for x in vec]}
            for (s, p, cpt, t), vec in zip(wanted, vectors)
        ])
    summary |= {"action": "indexed", "replaced": len(have), "seconds": round(time.perf_counter() - t0, 2)}
    log(f"indexed {len(chunks)} chunks from {docs} docs into policy_chunks "
        f"(replaced {len(have)} rows) in {summary['seconds']}s")
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--force", action="store_true", help="re-embed even if the table is current")
    args = ap.parse_args(argv)
    load_env()
    from app.db import DatabaseNotConfigured, database_url

    url = None
    try:
        url = database_url()
        print(f"index_chunks: database {redact(url)}", flush=True)
        run(force=args.force)
    except DatabaseNotConfigured as exc:
        print(f"index_chunks: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # report, don't dump a 40-line traceback for a dead DB
        print(f"index_chunks: FAILED: {explain_db_error(exc, url)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
