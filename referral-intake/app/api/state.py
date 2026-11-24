"""Per-app state: the pipeline runners, the background executor, per-referral
locks, and the paths the API serves from."""
from __future__ import annotations

import os
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import Request

from app.contracts import PipelineName, PipelineRunner, pipeline_name

ROOT = Path(__file__).resolve().parent.parent.parent  # referral-intake/
PACKETS_DIR = ROOT / "packets"
EVALS_DIR = ROOT / "evals"


def uploads_dir() -> Path:
    """UPLOADS_DIR (default uploads/), read per request; relative paths are under referral-intake/."""
    raw = os.getenv("UPLOADS_DIR", "").strip() or "uploads"
    path = Path(raw).expanduser()
    return path if path.is_absolute() else ROOT / path


def packet_path(referral_id: str) -> Path:
    return PACKETS_DIR / f"{referral_id}.pdf"


def make_runner(name: PipelineName) -> PipelineRunner:
    if name == "v1":
        from app.runner_v1 import V1Runner
        return V1Runner()
    from graph.service import GraphRunner
    return GraphRunner()


class ApiState:
    def __init__(self, runner: PipelineRunner | None = None, pipeline: PipelineName | None = None,
                 max_workers: int = 4):
        self._served = runner
        self._pipeline = pipeline or (runner.name if runner is not None else None)
        self._runners: dict[str, PipelineRunner] = {}
        if runner is not None:
            self._runners[runner.name] = runner
        self._runner_lock = threading.Lock()
        self._locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._locks_guard = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="referral")

    @property
    def pipeline(self) -> PipelineName:
        """What PIPELINE this API serves (fixed at first use)."""
        if self._pipeline is None:
            self._pipeline = pipeline_name()
        return self._pipeline

    def runner(self, name: PipelineName | None = None) -> PipelineRunner:
        """The served runner, or the one a stored record was started with
        (a referral is always resumed by the pipeline that started it)."""
        name = name or self.pipeline
        with self._runner_lock:
            if name not in self._runners:
                self._runners[name] = make_runner(name)
            return self._runners[name]

    def lock(self, referral_id: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks[referral_id]

    def shutdown(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)


def get_state(request: Request) -> ApiState:
    return request.app.state.api
