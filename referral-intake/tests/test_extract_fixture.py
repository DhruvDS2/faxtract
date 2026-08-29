"""The fixture engine and the box geometry it depends on."""
import json

import pytest

from app import extract_fixture
from app.extract_fixture import BANDS, extract
from app.models import Referral

ENTRY = {
    "patient_first_name": "Devon",
    "patient_last_name": "Ramirez",
    "patient_dob": "1947-06-14",
    "cpt_code": "73200",
    "icd10_codes": ["S52.501A"],
    "patient_address": "12 Elm St, Portland, OR 97201",
    "degradation": "clean",
    "template": "template_a",
    "pages": 2,
    "boxes": {
        "patient_last_name": {"left": 0.1, "top": 0.2, "width": 0.15, "height": 0.02, "page": 1},
        "cpt_code": {"left": 0.1, "top": 0.5, "width": 0.05, "height": 0.02, "page": 1},
    },
}


@pytest.fixture
def corpus(tmp_path):
    (tmp_path / "ground_truth.json").write_text(json.dumps({"referral_000.pdf": ENTRY}))
    return tmp_path / "referral_000.pdf"


def test_replays_ground_truth_values(corpus):
    referral, usage = extract(corpus)
    assert referral.patient_last_name == "Ramirez"
    assert referral.cpt_code == "73200"
    assert referral.patient_dob.isoformat() == "1947-06-14"
    assert usage == {"fixture_pages": 2}


def test_boxes_carry_the_page_index(corpus):
    referral, _ = extract(corpus)
    box = referral.boxes["patient_last_name"][0]
    assert box.page == 1          # a cover sheet pushed the referral to page 2
    assert (box.left, box.top) == (0.1, 0.2)


def test_fields_without_a_box_still_get_a_value(corpus):
    # patient_address is only drawn by one of the three templates. The value is
    # known, there is just nowhere on the page to point at.
    referral, _ = extract(corpus)
    assert referral.patient_address.startswith("12 Elm St")
    assert "patient_address" not in referral.boxes


def test_unlocated_fields_score_lower_than_located_ones(corpus):
    referral, _ = extract(corpus)
    assert referral.confidence["patient_address"] < referral.confidence["patient_last_name"]


def test_confidence_is_stable_across_runs(corpus):
    first, _ = extract(corpus)
    second, _ = extract(corpus)
    assert first.confidence == second.confidence


def test_confidence_respects_the_degradation_band(tmp_path):
    for level, (low, high) in BANDS.items():
        entry = dict(ENTRY, degradation=level)
        (tmp_path / "ground_truth.json").write_text(json.dumps({"referral_000.pdf": entry}))
        referral, _ = extract(tmp_path / "referral_000.pdf")
        located = [c for f, c in referral.confidence.items() if f in entry["boxes"]]
        assert located, level
        assert all(low <= c <= high for c in located), (level, located)


def test_finds_corpus_truth_when_the_pdf_was_copied_elsewhere(tmp_path, monkeypatch):
    # The API copies uploads into uploads/, far from corpus/out/. The file name
    # is what ties the upload back to its ground truth.
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "ground_truth.json").write_text(json.dumps({"referral_000.pdf": ENTRY}))
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(extract_fixture, "CORPUS_TRUTH", corpus / "ground_truth.json")

    referral, _ = extract(uploads / "referral_000.pdf")
    assert referral.patient_last_name == "Ramirez"
    assert referral.boxes["cpt_code"][0].page == 1


def test_missing_ground_truth_says_how_to_build_it(tmp_path, monkeypatch):
    monkeypatch.setattr(extract_fixture, "CORPUS_TRUTH", tmp_path / "nowhere.json")
    with pytest.raises(FileNotFoundError, match="generate_faxes"):
        extract(tmp_path / "referral_000.pdf")


def test_unknown_file_is_rejected(corpus):
    with pytest.raises(KeyError, match="ground_truth"):
        extract(corpus.parent / "not_in_the_corpus.pdf")


def test_confidence_and_boxes_are_never_treated_as_values(corpus):
    referral, _ = extract(corpus)
    assert isinstance(referral, Referral)
    assert set(referral.confidence) <= set(Referral.model_fields)
    assert "boxes" not in referral.confidence
