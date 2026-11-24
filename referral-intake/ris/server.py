"""Mock RIS: an HL7 v2 MLLP listener that accepts ORM^O01 orders and answers
with an ACK (MSA|AA, AE or AR).

    RIS_MLLP_HOST / RIS_MLLP_PORT   where it listens (default 127.0.0.1:2575)
    RIS_STORE_PATH                  the JSON order store (see ris/store.py)
    RIS_FAULT_LAST_NAMES            comma list; an ORM whose PID last name is on
                                    it is answered MSA|AE|<msgid>|simulated RIS
                                    rejection and not stored. Demo only.

Run:  python -m ris.server        (from referral-intake/)
"""
import os
import socketserver
import sys
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):  # `python ris/server.py` as well as `python -m ris.server`
    sys.path.insert(0, str(Path(__file__).parent.parent))

from ris import store  # noqa: E402

SB = b"\x0b"
EB = b"\x1c"
CR = b"\x0d"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 2575
FAULT_TEXT = "simulated RIS rejection"
MAX_MESSAGE_BYTES = 1_000_000
CLIENT_TIMEOUT_S = 30.0


def _log(msg: str) -> None:
    print(f"[RIS] {msg}", flush=True)


def listen_address() -> tuple[str, int]:
    host = os.getenv("RIS_MLLP_HOST", "").strip() or DEFAULT_HOST
    port = int(os.getenv("RIS_MLLP_PORT", "").strip() or DEFAULT_PORT)
    return host, port


def fault_last_names() -> set[str]:
    """Read per message, so the demo (and tests) can change it without a restart."""
    raw = os.getenv("RIS_FAULT_LAST_NAMES", "")
    return {n.strip().lower() for n in raw.split(",") if n.strip()}


def parse_message(raw: str) -> dict[str, list[list[str]]]:
    """segment id -> list of that segment's fields (each split on |)."""
    segments = [s for s in raw.replace("\n", "\r").split("\r") if s.strip()]
    fields: dict[str, list[list[str]]] = {}
    for seg in segments:
        parts = seg.split("|")
        fields.setdefault(parts[0], []).append(parts)
    return fields


def build_ack(message_id: str, code: str, text: str = "") -> str:
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    text = text.replace("|", " ").replace("\r", " ")
    return "\r".join([
        f"MSH|^~\\&|RIS|HOLLISPARK|REFERRAL_INTAKE|HOLLISPARK|{now}||ACK^O01|ACK{now}|P|2.5.1",
        f"MSA|{code}|{message_id}|{text}",
    ])


def _field(parts: list[str], i: int) -> str:
    return parts[i] if len(parts) > i else ""


def handle_message(raw: str) -> str:
    """Process one HL7 message and return the ACK to send back."""
    fields = parse_message(raw)
    msh = fields.get("MSH", [[]])[0]
    message_id = _field(msh, 9) or "UNKNOWN"
    if not msh:
        return build_ack(message_id, "AR", "no MSH segment")
    message_type = _field(msh, 8)
    if not message_type.startswith("ORM"):
        return build_ack(message_id, "AR", f"unsupported message type {message_type or '(none)'}")
    missing = [s for s in ("PID", "ORC", "OBR") if s not in fields]
    if missing:
        return build_ack(message_id, "AE", "missing required segment " + ",".join(missing))

    pid, orc, obr = fields["PID"][0], fields["ORC"][0], fields["OBR"][0]
    order_id = _field(orc, 2)
    if not order_id:
        return build_ack(message_id, "AE", "ORC-2 placer order number is empty")
    mrn = _field(pid, 3).split("^")[0]
    name = _field(pid, 5).split("^")
    last_name = name[0] if name else ""
    service = _field(obr, 4).split("^")

    if last_name.strip().lower() in fault_last_names():
        _log(f"rejected order {order_id} for {mrn}: {FAULT_TEXT} (RIS_FAULT_LAST_NAMES)")
        return build_ack(message_id, "AE", FAULT_TEXT)

    with store.transaction() as orders:
        orders[order_id] = {
            "order_id": order_id,
            "mrn": mrn,
            "patient_last_name": last_name,
            "patient_first_name": name[1] if len(name) > 1 else "",
            "dob": _field(pid, 7),
            "cpt": service[0] if service else "",
            "description": service[1] if len(service) > 1 else "",
            "priority": _field(obr, 5),
            "status": "scheduled_pending",
            "message_id": message_id,
            "received_at": datetime.now(timezone.utc).isoformat(),
            "raw": raw,
        }
    _log(f"accepted order {order_id} for {mrn} ({message_id})")
    return build_ack(message_id, "AA")


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(CLIENT_TIMEOUT_S)
        buf = b""
        try:
            while EB + CR not in buf:
                chunk = self.request.recv(4096)
                if not chunk:
                    return  # client closed (e.g. a health-check connect)
                buf += chunk
                if len(buf) > MAX_MESSAGE_BYTES:
                    _log("message too large; dropping connection")
                    return
        except OSError:
            return

        raw = buf.split(EB + CR, 1)[0].lstrip(SB).decode("utf-8", errors="replace")
        try:
            ack = handle_message(raw)
        except Exception as exc:  # never let one bad message kill the listener
            _log(f"error: {type(exc).__name__}: {exc}")
            message_id = _field(parse_message(raw).get("MSH", [[]])[0], 9) or "UNKNOWN"
            ack = build_ack(message_id, "AE", f"{type(exc).__name__}: {exc}"[:80])
        try:
            self.request.sendall(SB + ack.encode("utf-8") + EB + CR)
        except OSError:
            pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve(host: str | None = None, port: int | None = None) -> None:
    env_host, env_port = listen_address()
    host = host or env_host
    port = port if port is not None else env_port
    _log(f"MLLP listening on {host}:{port}, store {store.store_path()}")
    faults = fault_last_names()
    if faults:
        _log(f"fault injection on for last names: {', '.join(sorted(faults))}")
    with Server((host, port), Handler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    serve()
