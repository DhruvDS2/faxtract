"""Idempotent database bootstrap (CONTRACTS sections 7 and 12). Safe to re-run.

    python -m scripts.bootstrap [--force-index]

  1. app.db.init_db()        the pgvector extension and every table on app.db.Base
                             (policy_chunks, trace_events, the API's store tables)
  2. scripts.index_chunks    embed corpus/policies into policy_chunks
                             (skipped when the table already matches)
  3. graph.service.setup()   the LangGraph Postgres checkpointer tables

Loads referral-intake/.env first; DATABASE_URL is required (no default).
Exit codes: 0 ok, 2 database not configured / unreachable, 3 graph setup
not implemented, 1 anything else.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

if __package__ in (None, ""):  # `python scripts/bootstrap.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.common import ensure_importable, explain_db_error, first_line, load_env, redact  # noqa: E402

ensure_importable()


class BootstrapError(RuntimeError):
    def __init__(self, step: str, message: str, code: int = 1):
        super().__init__(f"{step}: {message}")
        self.step, self.code = step, code


def _log(msg):
    print(msg, flush=True)


def bootstrap(force_index: bool = False, log=_log) -> dict:
    """Run the three steps; raises BootstrapError naming the step that failed."""
    from sqlalchemy import inspect

    from app import db

    url = db.database_url()  # DatabaseNotConfigured if unset
    summary: dict = {"database": redact(url)}

    t = time.perf_counter()
    try:
        db.init_db()
        tables = sorted(inspect(db.get_engine()).get_table_names())
    except Exception as exc:
        raise BootstrapError("init_db", explain_db_error(exc, url), code=2) from exc
    summary["tables"] = tables
    log(f"  [1/3] init_db: vector extension + {len(tables)} tables ({', '.join(tables)}) "
        f"[{time.perf_counter() - t:.1f}s]")

    t = time.perf_counter()
    from scripts import index_chunks
    try:
        summary["index"] = index_chunks.run(force=force_index, log=lambda m: log(f"        {m}"))
    except Exception as exc:
        raise BootstrapError("index_chunks", explain_db_error(exc, url)) from exc
    log(f"  [2/3] index_chunks: {summary['index']['chunks']} chunks, {summary['index']['action']} "
        f"[{time.perf_counter() - t:.1f}s]")

    t = time.perf_counter()
    from graph import service
    try:
        service.setup()
    except NotImplementedError as exc:
        raise BootstrapError(
            "graph.service.setup",
            f"not implemented on this branch ({first_line(exc)}). The LangGraph checkpointer "
            "tables were NOT created; the served graph pipeline needs Lane C's graph/service.py. "
            "Steps 1-2 (tables, policy index) did complete.", code=3) from exc
    except Exception as exc:
        raise BootstrapError("graph.service.setup", explain_db_error(exc, url)) from exc
    summary["graph_setup"] = "ok"
    log(f"  [3/3] graph.service.setup: checkpointer tables ok [{time.perf_counter() - t:.1f}s]")
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Idempotent bootstrap: init_db, index policy chunks, graph setup.")
    ap.add_argument("--force-index", action="store_true", help="re-embed policy chunks even if current")
    args = ap.parse_args(argv)
    load_env()
    from app.db import DatabaseNotConfigured, database_url

    try:
        print(f"bootstrap: database {redact(database_url())}", flush=True)
        bootstrap(force_index=args.force_index)
    except DatabaseNotConfigured as exc:
        print(f"bootstrap: FAILED: {exc}", file=sys.stderr)
        return 2
    except BootstrapError as exc:
        print(f"bootstrap: FAILED at {exc}", file=sys.stderr)
        return exc.code
    print("bootstrap: done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
