"""Extraction entry point: given a fax PDF, return (Referral, usage).

EXTRACTOR picks the engine:

    claude   Claude vision -- the only engine that calls a model. Confidence is
             the model's own per-field estimate; the boxes the review UI
             highlights come from app/locate.py, which finds each value in a
             local Tesseract OCR pass over the page.
    fixture  The corpus ground truth, with the generator's recorded boxes and
             invented confidences. No network, no cost. For UI work only.
    replay   The committed real Claude run (evals/extraction_eval.json):
             genuine predictions and confidences, boxes from the corpus
             generator. No network, no cost. The demo and the v1-vs-v2
             benchmark use it.

The eval harness refuses fixture and replay: neither measures a model.
"""
import base64
import io
import os
import re
from pathlib import Path

ENGINES = ("claude", "fixture", "replay")
DEFAULT_ENGINE = "claude"

_CORPUS_NAME = re.compile(r"(referral_\d{3})")


def _poppler_path():
    # pdf2image shells out to pdftoppm/pdfinfo; POPPLER_PATH is only needed
    # when those are not on PATH.
    return os.getenv("POPPLER_PATH") or None


def pdf_to_images(pdf_path, dpi=200):
    from pdf2image import convert_from_path
    return convert_from_path(str(pdf_path), dpi=dpi, poppler_path=_poppler_path())


def pdf_page_count(pdf_path) -> int:
    from pdf2image import pdfinfo_from_path
    return int(pdfinfo_from_path(str(pdf_path), poppler_path=_poppler_path())["Pages"])


def image_to_b64(img):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def corpus_key(pdf_path) -> str | None:
    """'referral_013' for any stored copy of a corpus fax (uploads keep their file name)."""
    m = _CORPUS_NAME.search(Path(pdf_path).name)
    return m.group(1) if m else None


def engine_name() -> str:
    name = os.getenv("EXTRACTOR", DEFAULT_ENGINE).strip().lower()
    if name not in ENGINES:
        raise ValueError(f"EXTRACTOR={name!r} is not one of {ENGINES}")
    return name


def extract(pdf_path, replay_pace_s: float = 0.0):
    """replay_pace_s only affects the replay engine: sleep up to that many seconds
    of the recorded extraction latency, so a demo run takes as long as the real one did."""
    engine = engine_name()
    if engine == "claude":
        from app.extract_claude import extract as run_claude
        return run_claude(pdf_path)
    if engine == "fixture":
        from app.extract_fixture import extract as run_fixture
        return run_fixture(pdf_path)
    from app.extract_replay import extract as run_replay
    return run_replay(pdf_path, pace_s=replay_pace_s)
