import json
import os
import threading
from pathlib import Path

_lock = threading.Lock()


def store_path() -> Path:
    """RIS_STORE_PATH overrides where orders live (tests, demo); default ris/orders.json."""
    return Path(os.getenv("RIS_STORE_PATH") or Path(__file__).parent / "orders.json")


def load():
    path = store_path()
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save(orders):
    with _lock:
        store_path().write_text(json.dumps(orders, indent=2))


def find_by_patient(last_name, dob=None):
    return [o for o in load().values()
            if o["patient_last_name"].lower() == last_name.lower()
            and (dob is None or o["dob"] == dob.replace("-", ""))]
