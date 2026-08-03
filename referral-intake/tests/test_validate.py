from datetime import date

from app.models import Referral
from app.validate import validate

BASE = dict(
    patient_first_name="Danielle", patient_last_name="Strand", patient_dob=date(1978, 4, 12),
    patient_sex="F", referring_provider_npi="3845370576", requested_study="MRI lumbar spine without contrast",
    cpt_code="72148", laterality="n/a", icd10_codes=["M54.16"],
    payor_name="Meridian Health", member_id="MH123456789",
)


def fields(referral, severity=None):
    return {f.field for f in validate(referral) if severity is None or f.severity == severity}


def test_clean_referral_has_no_flags():
    assert validate(Referral(**BASE)) == []


def test_bad_npi_flagged():
    assert "referring_provider_npi" in fields(Referral(**{**BASE, "referring_provider_npi": "1111111111"}), "error")


def test_member_id_format_enforced_per_payor():
    assert "member_id" in fields(Referral(**{**BASE, "member_id": "12345678901"}), "error")


def test_laterality_required_for_extremity_cpt():
    bad = {**BASE, "cpt_code": "73721", "requested_study": "MRI lower extremity joint without contrast",
           "laterality": "n/a", "icd10_codes": ["M25.561"]}
    assert "laterality" in fields(Referral(**bad), "error")


def test_low_confidence_flagged():
    assert "member_id" in fields(Referral(**{**BASE, "confidence": {"member_id": 0.4}}), "warning")
