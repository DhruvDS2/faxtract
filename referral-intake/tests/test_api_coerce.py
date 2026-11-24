"""app/coerce.py: PATCH values are coerced through Referral (CONTRACTS §5)."""
from datetime import date

import pytest

from app.coerce import PatchError, apply_patch, corrections_for
from app.models import Referral


@pytest.fixture
def ref():
    return Referral(patient_first_name="Ciara", patient_last_name="Halloran", patient_dob=date(1959, 12, 16),
                    icd10_codes=["R19.00"], laterality="n/a", urgency="routine",
                    confidence={"patient_first_name": 0.95, "patient_dob": 0.98})


@pytest.mark.parametrize("raw,expected", [
    ("1961-03-04", date(1961, 3, 4)), ("03/04/1961", date(1961, 3, 4)), ("3/4/1961", date(1961, 3, 4)),
    (" 1961-03-04 ", date(1961, 3, 4)), ("", None), (None, None),
])
def test_dates(ref, raw, expected):
    out, changed = apply_patch(ref, {"patient_dob": raw})
    assert out.patient_dob == expected and changed == ["patient_dob"]


@pytest.mark.parametrize("raw", ["1961-02-30", "13/01/1961", "March 4 1961", "19610304", 19610304, ["1961-03-04"]])
def test_bad_dates(ref, raw):
    with pytest.raises(PatchError) as exc:
        apply_patch(ref, {"order_date": raw})
    assert [e.field for e in exc.value.errors] == ["order_date"]


@pytest.mark.parametrize("raw,expected", [
    ("m54.16, M51.26", ["M54.16", "M51.26"]), ("M54.16;M51.26", ["M54.16", "M51.26"]),
    ("M54.16 M51.26\tG89.29", ["M54.16", "M51.26", "G89.29"]), (["m54.16 ", " M51.26"], ["M54.16", "M51.26"]),
    (["M54.16, M51.26"], ["M54.16", "M51.26"]), ("M54.16, M54.16", ["M54.16"]), ("", []), (None, []), ([], []),
])
def test_icd_codes(ref, raw, expected):
    out, _ = apply_patch(ref, {"icd10_codes": raw})
    assert out.icd10_codes == expected


def test_icd_codes_bad_type(ref):
    with pytest.raises(PatchError):
        apply_patch(ref, {"icd10_codes": 42})
    with pytest.raises(PatchError):
        apply_patch(ref, {"icd10_codes": ["M54.16", 7]})


def test_text_and_literals(ref):
    out, changed = apply_patch(ref, {"patient_first_name": "  Clara ", "laterality": "Left", "patient_sex": "f",
                                     "urgency": "STAT", "referring_provider_npi": 1234567893})
    assert (out.patient_first_name, out.laterality, out.patient_sex, out.urgency) == ("Clara", "left", "F", "stat")
    assert out.referring_provider_npi == "1234567893"
    assert set(changed) == {"patient_first_name", "laterality", "patient_sex", "urgency", "referring_provider_npi"}
    with pytest.raises(PatchError) as exc:
        apply_patch(ref, {"laterality": "both", "patient_sex": "X", "urgency": ""})
    assert {e.field for e in exc.value.errors} == {"laterality", "patient_sex", "urgency"}


def test_unknown_and_frozen_fields(ref):
    with pytest.raises(PatchError) as exc:
        apply_patch(ref, {"nope": 1, "confidence": {}, "boxes": {}, "patient_first_name": "Clara"})
    assert {(e.field, e.message) for e in exc.value.errors} == {
        ("nope", "unknown field"), ("confidence", "confidence is not editable"), ("boxes", "boxes is not editable")}
    with pytest.raises(PatchError):
        apply_patch(ref, {})


def test_changed_fields_get_confidence_one_and_corrections(ref):
    out, changed = apply_patch(ref, {"patient_first_name": "Clara", "patient_last_name": "Halloran",
                                     "icd10_codes": "R19.00 R10.31"})
    assert changed == ["patient_first_name", "icd10_codes"]        # unchanged value is not a change
    assert out.confidence == {"patient_first_name": 1.0, "patient_dob": 0.98, "icd10_codes": 1.0}
    assert ref.confidence["patient_first_name"] == 0.95             # input untouched
    corr = corrections_for("abc12345", ref, out, changed)
    assert [(c.field, c.original_value, c.corrected_value, c.original_confidence) for c in corr] == [
        ("patient_first_name", "Ciara", "Clara", 0.95), ("icd10_codes", "R19.00", "R19.00, R10.31", None)]
    assert corr[0].corrected_at.tzinfo is not None
