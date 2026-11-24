"""Replay extraction: serves the committed real Claude run instead of calling it.

evals/extraction_eval.json holds what Claude vision actually returned for each of
the 60 corpus faxes -- every predicted value and its self-reported confidence,
plus the recorded latency and token usage. This engine hands those back, so the
whole downstream pipeline (validation, eligibility, the gate, review, RIS) runs
on genuine model output -- including its real mistakes, e.g. referral_013's
"Ciara" -- with no API key and no cost.

Boxes are not in the artifact; they come from the corpus generator's recorded
positions (corpus/out/ground_truth.json), i.e. where each field is printed.

Limits, stated plainly:
  * It only knows the 60 corpus faxes, matched by the referral_NNN in the file name.
  * Predictions were made on the pages as generated when the artifact was
    recorded. If the generator changes what a page prints, replayed values for
    that page are stale; evals/gt_changes.json (when present) lists such pages.
  * The eval runners refuse this engine: scoring a replay against its own
    artifact measures nothing new.
"""
import json
import time
from functools import lru_cache
from pathlib import Path

from app.extract import corpus_key
from app.models import Box, Referral

ROOT = Path(__file__).parent.parent
ARTIFACT = ROOT / "evals" / "extraction_eval.json"
CORPUS_TRUTH = ROOT / "corpus" / "out" / "ground_truth.json"

@lru_cache(maxsize=1)
def _records():
    data = json.loads(ARTIFACT.read_text())
    return {Path(r["file"]).stem: r for r in data["records"]}


@lru_cache(maxsize=1)
def _truth():
    if not CORPUS_TRUTH.exists():
        raise FileNotFoundError(
            f"{CORPUS_TRUTH} is missing; replay takes its boxes from the corpus. "
            f"Run: python corpus/generate_faxes.py --seed 42 --count 60"
        )
    return {Path(k).stem: v for k, v in json.loads(CORPUS_TRUTH.read_text()).items()}


def key_for(pdf_path) -> str:
    key = corpus_key(pdf_path)
    if key is None:
        raise KeyError(f"{Path(pdf_path).name}: replay only knows the corpus faxes "
                       f"(referral_000..referral_059). Use EXTRACTOR=claude for new faxes.")
    return key


def extract(pdf_path, pace_s: float = 0.0) -> tuple[Referral, dict]:
    """pace_s > 0 sleeps for the recorded extraction latency, capped at pace_s seconds."""
    key = key_for(pdf_path)
    record = _records().get(key)
    if record is None:
        raise KeyError(f"{key} is not in {ARTIFACT.name}")
    if record.get("error"):
        raise RuntimeError(f"recorded extraction for {key} failed: {record['error']}")

    recorded_boxes = _truth().get(key, {}).get("boxes", {})
    values, confidence, boxes = {}, {}, {}
    for f in record["fields"]:
        name, value = f["field"], f["predicted"]
        if f.get("confidence") is not None:
            confidence[name] = float(f["confidence"])
        if value in (None, "", []):
            continue
        values[name] = value
        box = recorded_boxes.get(name)
        if box:
            boxes[name] = [Box(page=box.get("page", 0), left=box["left"], top=box["top"],
                               width=box["width"], height=box["height"])]

    referral = Referral(**values, confidence=confidence, boxes=boxes)
    if pace_s and record.get("latency_ms"):
        time.sleep(min(pace_s, record["latency_ms"] / 1000))
    usage = dict(record.get("usage") or {})
    usage["replayed_latency_ms"] = record.get("latency_ms")
    return referral, usage
