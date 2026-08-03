import json
import re
from datetime import date
from pathlib import Path

from app.models import Flag, Referral

FIXTURES = Path(__file__).parent.parent / "corpus" / "fixtures"

_studies = json.loads((FIXTURES / "studies.json").read_text())
STUDIES = {s["cpt"]: s for s in _studies["studies"]}
ICD10 = _studies["icd10"]
PAYORS = {p["name"]: p for p in json.loads((FIXTURES / "payors.json").read_text())}


def npi_is_valid(npi):
    if not npi or not re.fullmatch(r"\d{10}", npi):
        return False
    digits = [int(c) for c in "80840" + npi[:9]]
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10 == int(npi[9])


def match_payor(name):
    if not name:
        return None
    for payor_name, payor in PAYORS.items():
        if payor_name.lower() in name.lower() or name.lower() in payor_name.lower():
            return payor
    return None


def validate(referral: Referral, confidence_threshold: float = 0.85) -> list[Flag]:
    flags = []

    for field in ["patient_first_name", "patient_last_name", "patient_dob",
                  "requested_study", "payor_name"]:
        if getattr(referral, field) in (None, ""):
            flags.append(Flag(field=field, severity="error", message="required field missing"))

    if referral.patient_dob:
        if referral.patient_dob > date.today():
            flags.append(Flag(field="patient_dob", severity="error", message="date of birth is in the future"))
        elif (date.today() - referral.patient_dob).days > 120 * 365:
            flags.append(Flag(field="patient_dob", severity="error", message="implausible age"))

    if referral.referring_provider_npi and not npi_is_valid(referral.referring_provider_npi):
        flags.append(Flag(field="referring_provider_npi", severity="error",
                          message="NPI fails checksum validation"))

    study = STUDIES.get(referral.cpt_code or "")
    if referral.cpt_code and not study:
        flags.append(Flag(field="cpt_code", severity="error",
                          message=f"CPT {referral.cpt_code} not in study catalog"))

    if study and referral.requested_study:
        words = set(re.findall(r"[a-z]{4,}", study["description"].lower()))
        got = set(re.findall(r"[a-z]{4,}", referral.requested_study.lower()))
        if words and len(words & got) / len(words) < 0.4:
            flags.append(Flag(field="cpt_code", severity="warning",
                              message=f'CPT describes "{study["description"]}" '
                                      f'but study text reads "{referral.requested_study}"'))

    if study and study["laterality_required"]:
        if referral.laterality in (None, "n/a"):
            flags.append(Flag(field="laterality", severity="error",
                              message=f'CPT {referral.cpt_code} requires laterality'))

    for code in referral.icd10_codes:
        if not re.fullmatch(r"[A-Z]\d{2}(\.[A-Z0-9]{1,4})?", code):
            flags.append(Flag(field="icd10_codes", severity="error",
                              message=f"{code} is not a valid ICD-10 format"))
        elif code not in ICD10:
            flags.append(Flag(field="icd10_codes", severity="warning",
                              message=f"{code} not in catalog"))
        elif study and code not in study["supporting_icd10"]:
            flags.append(Flag(field="icd10_codes", severity="warning",
                              message=f'{code} does not typically support CPT {referral.cpt_code}'))

    if not referral.icd10_codes:
        flags.append(Flag(field="icd10_codes", severity="error", message="no diagnosis code present"))

    payor = match_payor(referral.payor_name)
    if referral.payor_name and not payor:
        flags.append(Flag(field="payor_name", severity="error",
                          message=f'"{referral.payor_name}" is not a contracted payor'))
    if payor and referral.member_id:
        if not re.fullmatch(payor["member_id_regex"], referral.member_id):
            flags.append(Flag(field="member_id", severity="error",
                              message=f'member ID does not match {payor["name"]} format '
                                      f'({payor["member_id_format"]})'))
    if payor and not referral.member_id:
        flags.append(Flag(field="member_id", severity="error", message="member ID missing"))

    for field, score in referral.confidence.items():
        if score < confidence_threshold:
            flags.append(Flag(field=field, severity="warning",
                              message=f"low extraction confidence ({score:.2f})"))

    return flags


def is_auto_approvable(flags: list[Flag]) -> bool:
    return not any(f.severity == "error" for f in flags) and not flags
