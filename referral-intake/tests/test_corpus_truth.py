"""The ground-truth fix (decision 5): consistent laterality, address only when printed,
and the RNG stream untouched, so every other value and every unaffected page is
exactly what the committed extraction artifact was recorded on."""
import hashlib
import json
import re
from pathlib import Path

import pytest

from corpus.generate_faxes import TRUTH_FIELDS, build_corpus, font_files, load_fixtures

ROOT = Path(__file__).parent.parent
EVALS = ROOT / "evals"


@pytest.fixture(scope="module")
def generated():
    """The fixed generator, run in memory: {file: (truth, page digests)}."""
    return {name: (truth, [hashlib.sha256(p.tobytes()).hexdigest() for p in pages])
            for name, truth, pages in build_corpus(42, 60)}


@pytest.fixture(scope="module")
def changes():
    return json.loads((EVALS / "gt_changes.json").read_text())


def _artifact_truth():
    records = json.loads((EVALS / "extraction_eval.json").read_text())["records"]
    return {r["file"]: {f["field"]: f["truth"] for f in r["fields"]} | {
        "template": r["template"], "degradation": r["degradation"], "pages": r["pages"]} for r in records}


def test_unaffected_values_are_identical_to_the_recorded_truth(generated, changes):
    """Every truth value the fix did not deliberately change is byte-identical to the
    pre-fix truth. Later rows depend on every earlier draw, so this also proves the
    RNG stream is the same draw for draw."""
    listed = {(c["file"], f["field"]): f for c in changes["changes"] for f in c["fields"]}
    before = _artifact_truth()
    assert set(before) == set(generated)
    compared = 0
    for name, old in before.items():
        new = generated[name][0]
        for field, value in old.items():
            change = listed.get((name, field))
            if change:
                assert (change["old"], change["new"]) == (value, new[field]), (name, field)
            else:
                assert json.dumps(new[field]) == json.dumps(value), (name, field)
                compared += 1
    assert compared == 60 * 22 - len(listed)
    assert {f for _, f in listed} == {"laterality", "patient_address"}


def test_unaffected_pages_are_pixel_identical(generated, changes):
    fingerprint = json.loads((EVALS / "gt_prefix_fingerprint.json").read_text())
    reprinted = {c["file"] for c in changes["changes"] if c["printed_changed"]}
    assert len(reprinted) == 10
    if fingerprint["fonts"] != font_files():
        # Pixels depend on the host's fonts; the truth-level check above still holds.
        assert all(c["printed_changed"] == bool(c["replay_stale_fields"]) for c in changes["changes"])
        return
    for name, (_, digests) in generated.items():
        if name in reprinted:
            assert digests != fingerprint["pages"][name], name
        else:
            assert digests == fingerprint["pages"][name], name


def test_laterality_agrees_with_study_and_codes(generated):
    fx = load_fixtures()
    studies = {s["cpt"]: s for s in fx["studies"]["studies"]}
    icd10 = fx["studies"]["icd10"]
    for name, (truth, _) in generated.items():
        study = studies[truth["cpt_code"]]
        named = re.findall(r"\b(bilateral|left|right)\b", study["description"].lower())
        sides = {s for c in truth["icd10_codes"] for s in re.findall(r"\b(left|right)\b", icd10[c].lower())}
        if named:
            assert truth["laterality"] == named[0], name
        elif study["laterality_required"]:
            assert truth["laterality"] in ("left", "right"), name
            if len(sides) == 1:
                assert truth["laterality"] == sides.pop(), name
        else:
            assert truth["laterality"] == "n/a", name


def test_a_field_is_in_the_truth_only_when_the_page_prints_it(generated):
    for name, (truth, _) in generated.items():
        for field in TRUTH_FIELDS:
            printed = field in truth["boxes"]
            assert (truth[field] is not None) == printed, (name, field)
        assert (truth["patient_address"] is not None) == (truth["template"] == "template_a"), name


def test_gt_changes_is_current(changes):
    from evals.gt_changes import build

    fresh = build()
    for key in ("summary", "changes", "unchanged_files", "rules"):
        assert fresh[key] == changes[key], key
    s = changes["summary"]
    assert s["values_changed_by_field"] == {"patient_address": 40, "laterality": 10}
    assert s["pages_reprinted"] == 10
    for c in changes["changes"]:
        for f in c["fields"]:
            assert f["printed"] == (f["field"] == "laterality")


def test_corpus_on_disk_matches_the_generator(corpus, generated):
    on_disk = json.loads((corpus / "ground_truth.json").read_text())
    assert {n: t for n, (t, _) in generated.items()} == on_disk, (
        "corpus/out was made by another generator version: "
        "python corpus/generate_faxes.py --seed 42 --count 60")
