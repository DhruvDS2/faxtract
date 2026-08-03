import json
import socketserver
import threading
from datetime import datetime
from pathlib import Path

SB = b"\x0b"
EB = b"\x1c"
CR = b"\x0d"

STORE_PATH = Path(__file__).parent / "orders.json"
_lock = threading.Lock()


def load_orders():
    if STORE_PATH.exists():
        return json.loads(STORE_PATH.read_text())
    return {}


def save_orders(orders):
    STORE_PATH.write_text(json.dumps(orders, indent=2))


def parse_message(raw):
    segments = [s for s in raw.replace("\n", "\r").split("\r") if s.strip()]
    fields = {}
    for seg in segments:
        parts = seg.split("|")
        fields.setdefault(parts[0], []).append(parts)
    return fields


def build_ack(message_id, code, text=""):
    now = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return "\r".join([
        f"MSH|^~\\&|RIS|HOLLISPARK|REFERRAL_INTAKE|HOLLISPARK|{now}||ACK^O01|{now}|P|2.5.1",
        f"MSA|{code}|{message_id}|{text}",
    ])


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        buf = b""
        while EB + CR not in buf:
            chunk = self.request.recv(4096)
            if not chunk:
                return
            buf += chunk

        raw = buf.strip(SB).replace(EB + CR, b"").decode("utf-8", errors="replace")
        fields = parse_message(raw)

        msh = fields.get("MSH", [[]])[0]
        message_id = msh[9] if len(msh) > 9 else "UNKNOWN"

        try:
            if "ORC" not in fields or "OBR" not in fields or "PID" not in fields:
                ack = build_ack(message_id, "AE", "missing required segment")
            else:
                pid = fields["PID"][0]
                orc = fields["ORC"][0]
                obr = fields["OBR"][0]
                order_id = orc[2]
                mrn = pid[3].split("^")[0]
                name = pid[5].split("^")
                service = obr[4].split("^")

                with _lock:
                    orders = load_orders()
                    orders[order_id] = {
                        "order_id": order_id,
                        "mrn": mrn,
                        "patient_last_name": name[0] if name else "",
                        "patient_first_name": name[1] if len(name) > 1 else "",
                        "dob": pid[7] if len(pid) > 7 else "",
                        "cpt": service[0] if service else "",
                        "description": service[1] if len(service) > 1 else "",
                        "priority": obr[5] if len(obr) > 5 else "",
                        "status": "scheduled_pending",
                        "received_at": datetime.utcnow().isoformat(),
                        "raw": raw,
                    }
                    save_orders(orders)
                print(f"[RIS] accepted order {order_id} for {mrn}")
                ack = build_ack(message_id, "AA")
        except Exception as exc:
            print(f"[RIS] error: {exc}")
            ack = build_ack(message_id, "AE", str(exc)[:80])

        self.request.sendall(SB + ack.encode("utf-8") + EB + CR)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


def serve(host="0.0.0.0", port=2575):
    print(f"[RIS] MLLP listening on {host}:{port}")
    with Server((host, port), Handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    serve()
