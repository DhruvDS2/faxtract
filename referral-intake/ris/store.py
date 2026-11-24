"""The mock RIS's order store: one JSON file shared by the MLLP listener
(ris/server.py), the MCP server (ris/mcp_server.py) and the API's /orders check.

RIS_STORE_PATH overrides where it lives (tests, demo); the default is
ris/orders.json. Writes go to a temp file that replaces the store in one step,
so a reader in another process never sees half a file.
"""
import json
import os
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

_lock = threading.RLock()


def store_path() -> Path:
    return Path(os.getenv("RIS_STORE_PATH") or Path(__file__).parent / "orders.json")


def load() -> dict:
    path = store_path()
    if not path.exists():
        return {}
    text = path.read_text()
    return json.loads(text) if text.strip() else {}


def save(orders: dict) -> None:
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        fd, tmp = tempfile.mkstemp(prefix=".orders-", suffix=".json", dir=path.parent)
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(orders, fh, indent=2)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


@contextmanager
def transaction():
    """Load, let the caller change the dict, save -- atomically within this process."""
    with _lock:
        orders = load()
        yield orders
        save(orders)


def find_by_patient(last_name: str, dob: str | None = None) -> list[dict]:
    """Orders whose patient last name matches (case-insensitive); dob as YYYY-MM-DD or YYYYMMDD."""
    want_dob = dob.replace("-", "") if dob else None
    return [o for o in load().values()
            if (o.get("patient_last_name") or "").lower() == last_name.lower()
            and (want_dob is None or o.get("dob") == want_dob)]
