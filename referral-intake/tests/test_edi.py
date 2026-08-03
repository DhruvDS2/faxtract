from datetime import date

from app.edi import build_270, parse_271, parse_segments
from app.models import Referral
from app.payor import respond
from app.validate import npi_is_valid

REF = Referral(
    patient_first_name="Danielle", patient_last_name="Strand", patient_dob=date(1978, 4, 12),
    patient_sex="F", referring_provider_npi="3845370576", cpt_code="72148",
    requested_study="MRI lumbar spine without contrast", icd10_codes=["M54.16"],
    payor_name="Meridian Health", member_id="MH123456789",
)


def test_npi_checksum():
    assert npi_is_valid("3845370576")
    assert not npi_is_valid("3845370577")
    assert not npi_is_valid("12345")


def test_270_envelope_balances():
    segs = parse_segments(build_270(REF, "1234567893"))
    kinds = [s[0] for s in segs]
    assert kinds[0] == "ISA" and kinds[-1] == "IEA"
    assert kinds.count("ST") == kinds.count("SE") == 1
    se = next(s for s in segs if s[0] == "SE")
    counted = len([s for s in segs if s[0] not in ("ISA", "GS", "GE", "IEA")])
    assert int(se[1]) == counted


def test_271_round_trip():
    result = parse_271(respond(build_270(REF, "1234567893")))
    assert result.status in ("active_in_network", "active_out_of_network", "terminated", "not_found")
    assert result.payor_name == "Meridian Health"


def test_unknown_member_id_is_not_found():
    bad = REF.model_copy(update={"member_id": "99999"})
    assert parse_271(respond(build_270(bad, "1234567893"))).status == "not_found"
