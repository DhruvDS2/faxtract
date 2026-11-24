"""faxtract referral-intake HTTP API (docs/CONTRACTS.md §5).

    uvicorn app.main:app --port 8000          (from referral-intake/)

PIPELINE picks the served runner: graph (default, graph.service.GraphRunner) or
v1 (app.runner_v1.V1Runner). DATABASE_URL is required; startup fails loudly
without it. Every 4xx body is app.contracts.ErrorBody. No CORS: the UI talks to
the API through the Vite proxy.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

from app import db
from app.api import errors, referrals, system
from app.api.state import ApiState
from app.contracts import PipelineRunner, pipeline_name

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("faxtract.api")


def _startup(state: ApiState) -> None:
    db.database_url()          # DatabaseNotConfigured: fail loudly, never default
    if state._pipeline is None:
        pipeline_name()        # a bad PIPELINE value fails loudly too
    try:
        db.init_db()
        from app import store
        n = store.mark_interrupted_processing("interrupted: the API restarted while this referral was processing")
        if n:
            log.warning("marked %d referral(s) left in processing as failed", n)
    except db.DatabaseNotConfigured:
        raise
    except Exception as exc:  # DB down: keep serving so /health can say so
        log.error("database not ready at startup: %s", exc)


def create_app(runner: PipelineRunner | None = None) -> FastAPI:
    """runner: inject a PipelineRunner (tests); default is the one PIPELINE names."""
    load_dotenv(ROOT / ".env", override=False)
    state = ApiState(runner=runner)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        _startup(state)
        yield
        state.shutdown()

    app = FastAPI(title="faxtract referral intake", version="2.0", lifespan=lifespan)
    app.state.api = state
    errors.install(app)
    app.include_router(system.router)
    app.include_router(referrals.router)
    return app


app = create_app()
