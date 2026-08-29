"""Fixture extraction: replays the corpus ground truth. Never calls a cloud API.

This exists so the review queue can be developed and demonstrated with no AWS
account, no credentials, and no per-page cost. The boxes are real -- the corpus
generator records where it drew each value and carries those coordinates
through the skew and downscale -- so the highlight overlay can be verified
against them exactly.

The CONFIDENCE SCORES ARE FABRICATED. They are derived from a hash of the file
name and field so they stay stable between runs, and spread by the page's
degradation level so the review queue has a realistic mix. They say nothing
about how well any extractor reads the page, which is why the eval harness
refuses to score this engine.
"""
import hashlib
import json
from pathlib import Path

from app.models import Box, Referral

# Confidence bands per degradation level: (floor, ceiling).
BANDS = {"clean": (0.80, 0.99), "moderate": (0.62, 0.97), "hard": (0.42, 0.95)}
UNLOCATED_PENALTY = 0.25


CORPUS_TRUTH = Path(__file__).parent.parent / "corpus" / "out" / "ground_truth.json"


def _ground_truth(pdf_path):
    """Find the corpus ground truth for this PDF.

    The eval harness runs files in place under corpus/out/, but an upload
    through the API is copied into uploads/ first, so the file being read is
    often nowhere near the corpus. Look beside the PDF, then fall back to the
    corpus itself; the file name is what ties the two together.
    """
    candidates = [Path(pdf_path).parent / "ground_truth.json", CORPUS_TRUTH]
    for truth_file in candidates:
        if truth_file.exists():
            return json.loads(truth_file.read_text())
    searched = " and ".join(str(c) for c in candidates)
    raise FileNotFoundError(
        f"No ground_truth.json in {searched}. The fixture engine replays the "
        f"generated corpus; run: python corpus/generate_faxes.py --seed 42 --count 60"
    )


def _score(name, field, band, located):
    """A stable pseudo-random confidence in the band for this degradation level."""
    digest = hashlib.sha256(f"{name}:{field}".encode()).digest()
    fraction = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    low, high = band
    score = low + fraction * (high - low)
    if not located:
        # Nothing to point at on the page reads as a shakier value.
        score -= UNLOCATED_PENALTY
    return round(max(0.0, min(1.0, score)), 4)


def extract(pdf_path) -> tuple[Referral, dict]:
    name = Path(pdf_path).name
    truth = _ground_truth(pdf_path)
    if name not in truth:
        raise KeyError(f"{name} is not in ground_truth.json; the fixture engine "
                       f"only handles files produced by corpus/generate_faxes.py")

    entry = truth[name]
    band = BANDS.get(entry.get("degradation", "clean"), BANDS["clean"])
    recorded = entry.get("boxes", {})

    values, confidence, boxes = {}, {}, {}
    for field in Referral.model_fields:
        if field in ("confidence", "boxes") or field not in entry:
            continue
        value = entry[field]
        if value in (None, "", []):
            continue
        values[field] = value
        box = recorded.get(field)
        if box:
            boxes[field] = [Box(page=box.get("page", 0), left=box["left"], top=box["top"],
                                width=box["width"], height=box["height"])]
        confidence[field] = _score(name, field, band, located=bool(box))

    referral = Referral(**values, confidence=confidence, boxes=boxes)
    return referral, {"fixture_pages": entry.get("pages", 1)}
