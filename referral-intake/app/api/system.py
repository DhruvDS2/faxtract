"""Health, graph structure, RIS orders, eval artifacts, the corrections log."""
from __future__ import annotations

import json
import logging
import shutil
import socket
import subprocess
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends

from app import db, hl7, store
from app.api.errors import ApiError
from app.api.state import EVALS_DIR, ROOT, ApiState, get_state
from app.contracts import ArtifactEnvelope, GraphStructure, Health, RisOrderRow, confidence_threshold
from app.models import Correction

log = logging.getLogger("faxtract.api")
router = APIRouter()

RIS_PROBE_TIMEOUT_S = 0.3
BENCHMARK = EVALS_DIR / "benchmark_v1_v2.json"
EXTRACTION = EVALS_DIR / "extraction_eval.json"


def ris_up() -> bool:
    try:
        host, port = hl7.ris_address()
        with socket.create_connection((host, port), timeout=RIS_PROBE_TIMEOUT_S):
            return True
    except (OSError, ValueError):
        return False


def extractor_name() -> str:
    from app.extract import DEFAULT_ENGINE, engine_name
    try:
        return engine_name()
    except ValueError:
        import os
        return os.getenv("EXTRACTOR", DEFAULT_ENGINE)


@router.get("/health", response_model=Health)
def health(state: ApiState = Depends(get_state)):
    db_ok = db.ping()
    return Health(ok=db_ok, db=db_ok, ris="up" if ris_up() else "down", pipeline=state.pipeline,
                  extractor=extractor_name(), threshold=confidence_threshold())


@router.get("/graph/structure", response_model=GraphStructure)
def graph_structure(state: ApiState = Depends(get_state)):
    try:
        from graph import service
        structure = service.structure()
    except NotImplementedError as exc:
        raise ApiError(501, f"the v2 graph structure is not available yet: {exc}") from None
    except ImportError as exc:
        raise ApiError(501, f"the v2 graph cannot be imported: {exc}") from None
    return structure.model_copy(update={"active_pipeline": state.pipeline})


@router.get("/orders", response_model=list[RisOrderRow])
def orders():
    from ris import store as ris_store
    try:
        in_ris = set(ris_store.load().keys())
    except (OSError, ValueError) as exc:
        log.warning("cannot read the RIS store %s: %s", ris_store.store_path(), exc)
        in_ris = set()
    return store.order_rows(in_ris)


@router.get("/corrections", response_model=list[Correction])
def all_corrections():
    return store.list_corrections()


# --------------------------------------------------------------------------
# eval artifacts
# --------------------------------------------------------------------------

def _parse_time(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@lru_cache(maxsize=16)
def _git_commit_time(path: str, mtime: float) -> datetime | None:  # mtime: cache key only
    git = shutil.which("git")
    if not git:
        return None
    try:
        out = subprocess.run([git, "log", "-1", "--format=%cI", "--", Path(path).name],
                             cwd=Path(path).parent, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    return _parse_time(out.stdout.strip()) if out.returncode == 0 else None


def _shown(path: Path) -> str:
    """Repo-relative (from referral-intake/) when it can be, like the contract's paths."""
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def _envelope(path: Path, artifact_time) -> ArtifactEnvelope:
    if not path.is_file():
        raise ApiError(404, f"{_shown(path)} has not been generated")
    try:
        data = json.loads(path.read_text())
    except ValueError as exc:
        raise ApiError(500, f"{_shown(path)} is not valid JSON: {exc}") from None
    if not isinstance(data, dict):
        raise ApiError(500, f"{_shown(path)} is not a JSON object")
    run_at, source = _parse_time(artifact_time(data)), "artifact"
    if run_at is None:
        run_at, source = _git_commit_time(str(path), path.stat().st_mtime), "git"
    if run_at is None:
        source = "unknown"
    return ArtifactEnvelope(source=_shown(path), run_at=run_at, run_at_source=source, data=data)


def benchmark_envelope(path: Path = BENCHMARK) -> ArtifactEnvelope:
    return _envelope(path, lambda d: d.get("generated_at"))


def extraction_envelope(path: Path = EXTRACTION) -> ArtifactEnvelope:
    return _envelope(path, lambda d: (d.get("summary") or {}).get("run_at"))


@router.get("/evals/benchmark", response_model=ArtifactEnvelope)
def evals_benchmark():
    return benchmark_envelope(BENCHMARK)


@router.get("/evals/extraction", response_model=ArtifactEnvelope)
def evals_extraction():
    return extraction_envelope(EXTRACTION)
