import json
import threading
from pathlib import Path

STORE_PATH = Path(__file__).parent / "orders.json"
_lock = threading.Lock()


def load():
    if STORE_PATH.exists():
        return json.loads(STORE_PATH.read_text())
    return {}


def save(orders):
    with _lock:
        STORE_PATH.write_text(json.dumps(orders, indent=2))


def find_by_patient(last_name, dob=None):
    return [o for o in load().values()
            if o["patient_last_name"].lower() == last_name.lower()
            and (dob is None or o["dob"] == dob.replace("-", ""))]
