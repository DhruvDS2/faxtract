import socket
from datetime import datetime

from app.models import Referral
from app.validate import STUDIES

SB = b"\x0b"
EB = b"\x1c"
CR = b"\x0d"

PRIORITY = {"routine": "R", "urgent": "A", "stat": "S"}


def _esc(value):
    if value is None:
        return ""
    return (str(value).replace("\\", "\\E\\").replace("|", "\\F\\")
            .replace("^", "\\S\\").replace("~", "\\R\\").replace("&", "\\T\\"))


def build_orm(referral: Referral, order_id: str, mrn: str, message_id: str) -> str:
    now = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    study = STUDIES.get(referral.cpt_code or "", {})
    dob = referral.patient_dob.strftime("%Y%m%d") if referral.patient_dob else ""

    name = _esc(referral.referring_provider_name or "")
    if "," in name:
        prov_last, prov_rest = name.split(",", 1)
        prov_first = prov_rest.strip().split(" ")[0]
    else:
        parts = name.split(" ")
        prov_last = parts[-1] if parts else ""
        prov_first = parts[0] if len(parts) > 1 else ""
    provider = f"{_esc(referral.referring_provider_npi)}^{prov_last}^{prov_first}"

    lat = (referral.laterality or "n/a").upper()
    service = f'{_esc(referral.cpt_code)}^{_esc(study.get("description", referral.requested_study))}^C4'

    segments = [
        f"MSH|^~\\&|REFERRAL_INTAKE|HOLLISPARK|RIS|HOLLISPARK|{now}||ORM^O01|{message_id}|P|2.5.1",
        f"PID|1||{mrn}^^^HOLLISPARK^MR||{_esc(referral.patient_last_name)}^"
        f"{_esc(referral.patient_first_name)}||{dob}|{referral.patient_sex or 'U'}|||"
        f"{_esc(referral.patient_address)}||{_esc(referral.patient_phone)}",
        f"PV1|1|O|IMAGING^^^HOLLISPARK||||{provider}",
        f"ORC|NW|{order_id}|||||||{now}|||{provider}",
        f"OBR|1|{order_id}||{service}|{PRIORITY.get(referral.urgency, 'R')}||{now}"
        f"|||||||||{provider}||||||||{study.get('modality', '')}"
        f"|||||||{_esc(referral.clinical_indication)}",
    ]
    for i, code in enumerate(referral.icd10_codes, start=1):
        segments.append(f"DG1|{i}||{_esc(code)}^^I10|||A")
    if lat != "N/A":
        segments.append(f"ZDS|LATERALITY^{lat}")

    return "\r".join(segments)


def send_mllp(message: str, host: str = "localhost", port: int = 2575, timeout: float = 10.0) -> str:
    payload = SB + message.encode("utf-8") + EB + CR
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(payload)
        buf = b""
        while EB + CR not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
    return buf.strip(SB).replace(EB + CR, b"").decode("utf-8", errors="replace")


def ack_is_accept(ack: str) -> bool:
    for line in ack.split("\r"):
        if line.startswith("MSA|"):
            return line.split("|")[1] == "AA"
    return False
