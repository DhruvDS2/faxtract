"""Fixture extraction: hands back the corpus ground truth. Never calls a model.

It lets the review UI be built and exercised with no API key. Values and boxes
are exactly what corpus/generate_faxes.py drew and recorded. The confidences
are invented -- a stable hash of (file, field) spread over a band that widens
with the page's degradation -- and say nothing about extraction quality, which
is why the eval harness refuses this engine.
"""
import hashlib
import json
from pathlib import Path

from app.extract import corpus_key
from app.models import Box, Referral

TRUTH = Path(__file__).parent.parent / "corpus" / "out" / "ground_truth.json"

# (low, high) confidence per degradation level
SPREAD = {"clean": (0.82, 0.99), "moderate": (0.65, 0.97), "hard": (0.45, 0.95)}

_SKIP = {"confidence", "boxes"}


def _entry(pdf_path) -> tuple[str, dict]:
    if not TRUTH.exists():
        raise FileNotFoundError(f"{TRUTH} is missing. Generate the corpus first: "
                                f"python corpus/generate_faxes.py --seed 42 --count 60")
    key = corpus_key(pdf_path)
    truth = {Path(name).stem: row for name, row in json.loads(TRUTH.read_text()).items()}
    if key is None or key not in truth:
        raise KeyError(f"{Path(pdf_path).name} is not a corpus fax; the fixture engine only "
                       f"knows referral_000..referral_059")
    return key, truth[key]


def _invented_confidence(key: str, field: str, degradation: str) -> float:
    low, high = SPREAD.get(degradation, SPREAD["clean"])
    h = hashlib.blake2s(f"{key}|{field}".encode(), digest_size=4).digest()
    return round(low + int.from_bytes(h, "big") / 0xFFFFFFFF * (high - low), 3)


def extract(pdf_path) -> tuple[Referral, dict]:
    key, row = _entry(pdf_path)
    degradation = row.get("degradation", "clean")
    drawn = row.get("boxes", {})

    values, confidence, boxes = {}, {}, {}
    for field in Referral.model_fields:
        if field in _SKIP or row.get(field) in (None, "", []):
            continue
        values[field] = row[field]
        confidence[field] = _invented_confidence(key, field, degradation)
        where = drawn.get(field)
        if where:
            boxes[field] = [Box(**where)]
    return Referral(**values, confidence=confidence, boxes=boxes), {"pages": row.get("pages", 1)}
