"""HL7 v2 ORM^O01 builder and the MLLP client for the mock RIS.

Frozen, call-compatible (docs/CONTRACTS.md §15; graph/ and app/pipeline.py use them):
    build_orm(referral, order_id, mrn, message_id) -> str   one DG1 per ICD-10 code
    send_mllp(message, host, port, timeout=10.0) -> str     raw ACK; raises on socket errors
    ack_is_accept(ack) -> bool

Helpers for callers that must never raise (the API's runners):
    ris_address() -> (host, port)      RIS_MLLP_HOST / RIS_MLLP_PORT, read at call time
    parse_ack(ack) -> (code, text)     code is AA/AE/AR, or None if there is no usable MSA
    send_order(message, ...) -> SendResult   every failure becomes SendResult.error
"""
from __future__ import annotations

import os
import re
import socket
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone

from app.models import Referral
from app.validate import STUDIES

SB = b"\x0b"
EB = b"\x1c"
CR = b"\x0d"

DEFAULT_RIS_HOST = "127.0.0.1"
DEFAULT_RIS_PORT = 2575

PRIORITY = {"routine": "R", "urgent": "A", "stat": "S"}
ACK_CODES = ("AA", "AE", "AR")
_ICD_SPLIT = re.compile(r"[,;\s]+")


def _esc(value) -> str:
    if value is None:
        return ""
    return (str(value).replace("\\", "\\E\\").replace("|", "\\F\\")
            .replace("^", "\\S\\").replace("~", "\\R\\").replace("&", "\\T\\"))


def _hl7_date(value) -> str:
    """YYYYMMDD for a date; tolerates an ISO string so a stray str can never 500."""
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.strftime("%Y%m%d")
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y%m%d")
        except ValueError:
            continue
    return ""


def icd_codes(value) -> list[str]:
    """The referral's ICD-10 codes as a clean list. A single string is split on
    commas, semicolons and whitespace -- never iterated character by character."""
    if value is None:
        return []
    items = [value] if isinstance(value, str) else list(value)
    out: list[str] = []
    for item in items:
        for code in _ICD_SPLIT.split(str(item)):
            code = code.strip().upper()
            if code and code not in out:
                out.append(code)
    return out


_CREDENTIAL = re.compile(r"[,\s]+(MD|DO|NP|PA|PA-C|PHD|DPM|FNP|RN)\.?$", re.IGNORECASE)
_HONORIFIC = re.compile(r"^(dr\.?)\s+", re.IGNORECASE)


def provider_name_parts(name: str | None) -> tuple[str, str]:
    """(last, first) from "Renee Castellanos, MD", "Castellanos, Renee" or "Dr. Renee Castellanos"."""
    name = (name or "").strip()
    while True:
        stripped = _CREDENTIAL.sub("", name).strip()
        if stripped == name:
            break
        name = stripped
    name = _HONORIFIC.sub("", name).strip()
    if "," in name:
        last, rest = name.split(",", 1)
        rest_parts = rest.split()
        return last.strip(), (rest_parts[0] if rest_parts else "")
    parts = name.split()
    if not parts:
        return "", ""
    return parts[-1], (parts[0] if len(parts) > 1 else "")


def _provider(referral: Referral) -> str:
    last, first = provider_name_parts(referral.referring_provider_name)
    return f"{_esc(referral.referring_provider_npi)}^{_esc(last)}^{_esc(first)}"


def build_orm(referral: Referral, order_id: str, mrn: str, message_id: str) -> str:
    """ORM^O01 (new order) for one referral. Segments: MSH PID PV1 ORC OBR DG1* [ZDS]."""
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    study = STUDIES.get(referral.cpt_code or "", {})
    provider = _provider(referral)
    laterality = (referral.laterality or "n/a").upper()
    description = study.get("description", referral.requested_study)
    service = f"{_esc(referral.cpt_code)}^{_esc(description)}^C4"

    segments = [
        f"MSH|^~\\&|REFERRAL_INTAKE|HOLLISPARK|RIS|HOLLISPARK|{now}||ORM^O01|{_esc(message_id)}|P|2.5.1",
        f"PID|1||{_esc(mrn)}^^^HOLLISPARK^MR||{_esc(referral.patient_last_name)}^"
        f"{_esc(referral.patient_first_name)}||{_hl7_date(referral.patient_dob)}|"
        f"{referral.patient_sex or 'U'}|||{_esc(referral.patient_address)}||{_esc(referral.patient_phone)}",
        f"PV1|1|O|IMAGING^^^HOLLISPARK||||{provider}",
        f"ORC|NW|{_esc(order_id)}|||||||{now}|||{provider}",
        f"OBR|1|{_esc(order_id)}||{service}|{PRIORITY.get(referral.urgency, 'R')}||{now}"
        f"|||||||||{provider}||||||||{study.get('modality', '')}"
        f"|||||||{_esc(referral.clinical_indication)}",
    ]
    for i, code in enumerate(icd_codes(referral.icd10_codes), start=1):
        segments.append(f"DG1|{i}||{_esc(code)}^^I10|||A")
    if laterality != "N/A":
        segments.append(f"ZDS|LATERALITY^{laterality}")
    return "\r".join(segments)


def with_message_id(message: str, message_id: str) -> str:
    """The same ORM with MSH-10 replaced (a retry re-sends the stored order under a new id)."""
    segments = message.split("\r")
    if segments and segments[0].startswith("MSH|"):
        fields = segments[0].split("|")
        if len(fields) > 9:
            fields[9] = _esc(message_id)
            segments[0] = "|".join(fields)
    return "\r".join(segments)


def send_mllp(message: str, host: str = DEFAULT_RIS_HOST, port: int = DEFAULT_RIS_PORT,
              timeout: float = 10.0) -> str:
    """Send one framed message and return the raw ACK text. Raises OSError on socket trouble."""
    payload = SB + message.encode("utf-8") + EB + CR
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(payload)
        buf = b""
        while EB + CR not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
    return buf.split(EB + CR, 1)[0].lstrip(SB).decode("utf-8", errors="replace")


def parse_ack(ack: str | None) -> tuple[str | None, str]:
    """(code, text) from the MSA segment: code in AA/AE/AR, else None."""
    for line in (ack or "").replace("\n", "\r").split("\r"):
        if line.startswith("MSA|"):
            parts = line.split("|")
            code = parts[1].strip().upper() if len(parts) > 1 else ""
            text = parts[3].strip() if len(parts) > 3 else ""
            return (code if code in ACK_CODES else None), text
    return None, ""


def ack_is_accept(ack: str) -> bool:
    return parse_ack(ack)[0] == "AA"


def ris_address() -> tuple[str, int]:
    host = os.getenv("RIS_MLLP_HOST", "").strip() or DEFAULT_RIS_HOST
    raw_port = os.getenv("RIS_MLLP_PORT", "").strip()
    try:
        port = int(raw_port) if raw_port else DEFAULT_RIS_PORT
    except ValueError:
        raise ValueError(f"RIS_MLLP_PORT={raw_port!r} is not a port number") from None
    return host, port


@dataclass
class SendResult:
    host: str
    port: int
    code: str | None = None      # AA / AE / AR, None if no usable ACK
    text: str = ""               # MSA-3 text
    raw: str | None = None       # the ACK as received
    error: str | None = None     # None only on AA
    duration_ms: float = 0.0

    @property
    def accepted(self) -> bool:
        return self.code == "AA"


def send_order(message: str, host: str | None = None, port: int | None = None,
               timeout: float = 10.0) -> SendResult:
    """Send an ORM to the RIS and classify the outcome. Never raises."""
    t0 = time.perf_counter()
    try:
        env_host, env_port = ris_address()
    except ValueError as exc:
        return SendResult(host or "?", port or 0, error=str(exc))
    host = host or env_host
    port = port if port is not None else env_port
    where = f"{host}:{port}"
    result = SendResult(host, port)
    try:
        raw = send_mllp(message, host=host, port=port, timeout=timeout)
    except ConnectionRefusedError:
        result.error = f"connection refused ({where})"
    except (socket.timeout, TimeoutError):
        result.error = f"timed out after {timeout:g}s waiting for the RIS ({where})"
    except socket.gaierror as exc:
        result.error = f"cannot resolve RIS host {host!r}: {exc}"
    except OSError as exc:
        result.error = f"{type(exc).__name__}: {exc} ({where})"
    else:
        result.raw = raw
        result.code, result.text = parse_ack(raw)
        if result.code is None:
            shown = raw.replace("\r", " | ").strip()[:120]
            result.error = (f"unparseable ACK from RIS ({where}): {shown!r}" if shown
                            else f"no ACK from RIS ({where}): connection closed")
        elif result.code != "AA":
            result.error = f"RIS answered {result.code}" + (f": {result.text}" if result.text else "")
    result.duration_ms = (time.perf_counter() - t0) * 1000
    return result
