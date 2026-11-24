"""Guards shared by the eval runners.

* Never run without credentials: a keyless run used to score every file as a
  failure and overwrite the committed evidence with 4.1%.
* Never clobber a committed artifact: write to a temp file beside it and
  os.replace() only when every file succeeded; a failed run is saved outside
  the repo instead.
* Log what every keyed run cost (evals/cost_log.jsonl).
"""
import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

LIVE_ENGINES = ("claude",)
COST_LOG = Path(__file__).parent / "cost_log.jsonl"


def require_live_engine(engine: str) -> None:
    if engine not in LIVE_ENGINES:
        raise SystemExit(
            f"EXTRACTOR={engine} does not call a model (fixture replays ground truth, "
            f"replay replays the committed Claude run), so scoring it measures nothing. "
            f"Set EXTRACTOR=claude."
        )
    if engine == "claude" and not os.getenv("ANTHROPIC_API_KEY"):
        raise SystemExit("EXTRACTOR=claude but ANTHROPIC_API_KEY is not set: refusing to run.")


def write_json_atomic(path, payload) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(payload, fh, indent=2, default=str)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return path


def quarantine(payload, name: str) -> Path:
    """Save a failed run outside the repo and return where it went."""
    out = Path(tempfile.gettempdir()) / f"{name}.failed-{int(time.time())}.json"
    out.write_text(json.dumps(payload, indent=2, default=str))
    return out


def log_cost(runner: str, engine: str, n_files: int, dollars: float, usage: dict, ok: bool) -> None:
    entry = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "runner": runner, "engine": engine, "n_files": n_files,
        "dollars": round(dollars, 4), "usage": usage, "ok": ok,
    }
    with COST_LOG.open("a") as fh:
        fh.write(json.dumps(entry) + "\n")
    print(f"[cost] {runner} engine={engine} files={n_files} ${entry['dollars']} ok={ok} -> {COST_LOG.name}")
