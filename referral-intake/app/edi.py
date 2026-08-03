from datetime import datetime

from app.models import EligibilityResult, Referral
from app.validate import STUDIES, match_payor

ELEM = "*"
SUB = ":"
SEG = "~"

SUBMITTER_ID = "HOLLISPARK"
RECEIVER_ID = "CLEARINGHOUSE"


def _seg(*elements):
    return ELEM.join(str(e) for e in elements) + SEG


def build_270(referral: Referral, clinic_npi: str, control_number: int = 1) -> str:
    now = datetime.utcnow()
    payor = match_payor(referral.payor_name)
    study = STUDIES.get(referral.cpt_code or "")
    service_type = study["service_type_code"] if study else "30"
    ctrl = f"{control_number:09d}"

    isa = (
        "ISA*00*          *00*          *ZZ*"
        + SUBMITTER_ID.ljust(15)
        + "*ZZ*"
        + RECEIVER_ID.ljust(15)
        + f"*{now:%y%m%d}*{now:%H%M}*^*00501*{ctrl}*0*P*{SUB}{SEG}"
    )

    segments = [
        isa,
        _seg("GS", "HS", SUBMITTER_ID, RECEIVER_ID, f"{now:%Y%m%d}", f"{now:%H%M}",
             control_number, "X", "005010X279A1"),
        _seg("ST", "270", "0001", "005010X279A1"),
        _seg("BHT", "0022", "13", f"REF{control_number:06d}", f"{now:%Y%m%d}", f"{now:%H%M}"),

        _seg("HL", "1", "", "20", "1"),
        _seg("NM1", "PR", "2", payor["name"] if payor else (referral.payor_name or "UNKNOWN"),
             "", "", "", "", "PI", payor["payor_id"] if payor else "UNKNOWN"),

        _seg("HL", "2", "1", "21", "1"),
        _seg("NM1", "1P", "2", "HOLLIS PARK IMAGING", "", "", "", "", "XX", clinic_npi),

        _seg("HL", "3", "2", "22", "0"),
        _seg("TRN", "1", f"{control_number:09d}", SUBMITTER_ID),
        _seg("NM1", "IL", "1", referral.patient_last_name or "", referral.patient_first_name or "",
             "", "", "", "MI", referral.member_id or ""),
        _seg("DMG", "D8", referral.patient_dob.strftime("%Y%m%d") if referral.patient_dob else "",
             referral.patient_sex or "U"),
        _seg("DTP", "291", "D8", f"{now:%Y%m%d}"),
        _seg("EQ", service_type),
    ]

    st_count = len([s for s in segments if not s.startswith(("ISA", "GS"))]) + 1
    segments.append(_seg("SE", st_count, "0001"))
    segments.append(_seg("GE", "1", control_number))
    segments.append(_seg("IEA", "1", ctrl))
    return "".join(segments)


def parse_segments(edi: str) -> list[list[str]]:
    return [s.split(ELEM) for s in edi.split(SEG) if s.strip()]


def parse_271(edi: str) -> EligibilityResult:
    segments = parse_segments(edi)
    payor_name = None
    plan_name = None
    status = "not_found"
    deductible = None
    coinsurance = None

    for seg in segments:
        if seg[0] == "NM1" and len(seg) > 3 and seg[1] == "PR":
            payor_name = seg[3]
        if seg[0] == "AAA":
            status = "not_found"
        if seg[0] == "EB":
            code = seg[1] if len(seg) > 1 else ""
            if code == "1":
                status = "active_in_network"
                if len(seg) > 5 and seg[5]:
                    plan_name = seg[5]
            elif code == "U":
                status = "active_out_of_network"
                if len(seg) > 5 and seg[5]:
                    plan_name = seg[5]
            elif code == "6":
                status = "terminated"
            elif code == "C" and len(seg) > 7 and seg[7]:
                deductible = float(seg[7])
            elif code == "A" and len(seg) > 8 and seg[8]:
                coinsurance = float(seg[8]) * 100

    return EligibilityResult(
        status=status,
        payor_name=payor_name,
        plan_name=plan_name,
        deductible_remaining=deductible,
        coinsurance_percent=coinsurance,
        raw_271=edi,
    )


def pretty(edi: str) -> str:
    return "\n".join(s + SEG for s in edi.split(SEG) if s.strip())
