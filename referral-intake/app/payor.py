import hashlib
import re
from datetime import datetime

from app.edi import SEG, _seg, parse_segments
from app.validate import PAYORS

PLAN_NAMES = {
    "Meridian Health": "MERIDIAN SELECT PPO",
    "Cascade Mutual": "CASCADE CHOICE HMO",
    "Northgate Plan": "NORTHGATE ADVANTAGE PPO",
}


def _outcome(member_id: str) -> str:
    """Deterministic per member ID so reruns are stable. Roughly 70/10/10/10."""
    n = int(hashlib.sha256(member_id.encode()).hexdigest(), 16) % 100
    if n < 70:
        return "active_in_network"
    if n < 80:
        return "active_out_of_network"
    if n < 90:
        return "terminated"
    return "not_found"


def respond(edi_270: str) -> str:
    segments = parse_segments(edi_270)
    now = datetime.utcnow()

    payor_name = ""
    member_id = ""
    last = first = dob = sex = ""
    provider_npi = ""
    service_type = "30"

    for seg in segments:
        if seg[0] == "NM1" and seg[1] == "PR":
            payor_name = seg[3]
        elif seg[0] == "NM1" and seg[1] == "1P":
            provider_npi = seg[9] if len(seg) > 9 else ""
        elif seg[0] == "NM1" and seg[1] == "IL":
            last, first = seg[3], seg[4]
            member_id = seg[9] if len(seg) > 9 else ""
        elif seg[0] == "DMG":
            dob, sex = seg[2], seg[3] if len(seg) > 3 else "U"
        elif seg[0] == "EQ":
            service_type = seg[1]

    payor = PAYORS.get(payor_name)
    known_format = bool(payor and member_id and re.fullmatch(payor["member_id_regex"], member_id))
    outcome = _outcome(member_id) if known_format else "not_found"

    out = [
        "ISA*00*          *00*          *ZZ*CLEARINGHOUSE  *ZZ*HOLLISPARK     "
        f"*{now:%y%m%d}*{now:%H%M}*^*00501*000000001*0*P*:{SEG}",
        _seg("GS", "HB", "CLEARINGHOUSE", "HOLLISPARK", f"{now:%Y%m%d}", f"{now:%H%M}",
             1, "X", "005010X279A1"),
        _seg("ST", "271", "0001", "005010X279A1"),
        _seg("BHT", "0022", "11", "RESP000001", f"{now:%Y%m%d}", f"{now:%H%M}"),
        _seg("HL", "1", "", "20", "1"),
        _seg("NM1", "PR", "2", payor_name, "", "", "", "", "PI",
             payor["payor_id"] if payor else "UNKNOWN"),
        _seg("HL", "2", "1", "21", "1"),
        _seg("NM1", "1P", "2", "HOLLIS PARK IMAGING", "", "", "", "", "XX", provider_npi),
        _seg("HL", "3", "2", "22", "0"),
        _seg("NM1", "IL", "1", last, first, "", "", "", "MI", member_id),
        _seg("DMG", "D8", dob, sex),
    ]

    plan = PLAN_NAMES.get(payor_name, "")
    if outcome == "not_found":
        out.append(_seg("AAA", "N", "", "75", "C"))
    elif outcome == "terminated":
        out.append(_seg("EB", "6", "IND", service_type, "", plan))
        out.append(_seg("DTP", "347", "D8", "20251231"))
    else:
        code = "1" if outcome == "active_in_network" else "U"
        out.append(_seg("EB", code, "IND", service_type, "", plan))
        out.append(_seg("EB", "C", "IND", service_type, "", "", "23", "1500"))
        out.append(_seg("EB", "A", "IND", service_type, "", "", "", "", "0.20"))
        out.append(_seg("DTP", "346", "D8", "20260101"))

    st_count = len([s for s in out if not s.startswith(("ISA", "GS"))]) + 1
    out.append(_seg("SE", st_count, "0001"))
    out.append(_seg("GE", "1", "1"))
    out.append(_seg("IEA", "1", "000000001"))
    return "".join(out)
