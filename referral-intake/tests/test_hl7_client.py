"""app/hl7.py: ORM building (one DG1 per code, valid DOB) and the RIS client's
error handling (refused / timeout / garbage / AE never raise)."""
import socket
import threading
from datetime import date

import pytest

from app import hl7
from app.models import Referral


def _segments(message: str, seg_id: str) -> list[list[str]]:
    return [s.split("|") for s in message.split("\r") if s.startswith(seg_id + "|")]


def _referral(**kw) -> Referral:
    base = dict(patient_first_name="Clara", patient_last_name="Halloran", patient_dob=date(1959, 12, 16),
                patient_sex="F", referring_provider_name="Terrence Beaumont, MD",
                referring_provider_npi="9224288636", cpt_code="74177", icd10_codes=["R19.00", "R10.31"],
                urgency="routine", laterality="n/a")
    base.update(kw)
    return Referral(**base)


def test_build_orm_one_dg1_per_code_and_dob():
    msg = hl7.build_orm(_referral(icd10_codes=["M54.16", "M51.26", "G89.29"]), "ORDX", "MRNX", "MSGX-1")
    dg1 = _segments(msg, "DG1")
    assert [d[3] for d in dg1] == ["M54.16^^I10", "M51.26^^I10", "G89.29^^I10"]
    assert [d[1] for d in dg1] == ["1", "2", "3"]
    pid = _segments(msg, "PID")[0]
    assert pid[7] == "19591216"
    assert pid[5] == "Halloran^Clara"
    assert _segments(msg, "MSH")[0][9] == "MSGX-1"
    assert _segments(msg, "ORC")[0][2] == "ORDX"


def test_build_orm_never_splits_a_code_string_into_characters():
    # model_construct skips validation: the shape the old PATCH bug produced
    bad = Referral.model_construct(**_referral().model_dump() | {"icd10_codes": "M54.16, M51.26",
                                                                 "patient_dob": "1959-12-16"})
    msg = hl7.build_orm(bad, "ORDX", "MRNX", "MSGX-1")
    assert [d[3] for d in _segments(msg, "DG1")] == ["M54.16^^I10", "M51.26^^I10"]
    assert _segments(msg, "PID")[0][7] == "19591216"


def test_provider_name_parts():
    assert hl7.provider_name_parts("Terrence Beaumont, MD") == ("Beaumont", "Terrence")
    assert hl7.provider_name_parts("Beaumont, Terrence") == ("Beaumont", "Terrence")
    assert hl7.provider_name_parts("Dr. Owen Nagata") == ("Nagata", "Owen")
    assert hl7.provider_name_parts(None) == ("", "")
    msg = hl7.build_orm(_referral(), "O", "M", "X")
    assert _segments(msg, "PV1")[0][7] == "9224288636^Beaumont^Terrence"


def test_with_message_id_replaces_msh10_only():
    msg = hl7.build_orm(_referral(), "ORD1", "MRN1", "MSG1-1")
    again = hl7.with_message_id(msg, "MSG1-2")
    assert _segments(again, "MSH")[0][9] == "MSG1-2"
    assert again.split("\r")[1:] == msg.split("\r")[1:]


def test_parse_ack():
    assert hl7.parse_ack("MSH|^~\\&|RIS\rMSA|AA|MSG1|") == ("AA", "")
    assert hl7.parse_ack("MSH|x\rMSA|AE|MSG1|simulated RIS rejection") == ("AE", "simulated RIS rejection")
    assert hl7.parse_ack("MSA|AR|M|bad type") == ("AR", "bad type")
    assert hl7.parse_ack("garbage") == (None, "")
    assert hl7.parse_ack(None) == (None, "")
    assert hl7.ack_is_accept("MSA|AA|M") and not hl7.ack_is_accept("MSA|AE|M")


def test_ris_address_reads_env_at_call_time(monkeypatch):
    monkeypatch.setenv("RIS_MLLP_HOST", "10.1.2.3")
    monkeypatch.setenv("RIS_MLLP_PORT", "2999")
    assert hl7.ris_address() == ("10.1.2.3", 2999)
    monkeypatch.delenv("RIS_MLLP_HOST")
    monkeypatch.delenv("RIS_MLLP_PORT")
    assert hl7.ris_address() == ("127.0.0.1", 2575)


def test_send_order_accepted(ris_server):
    result = hl7.send_order(hl7.build_orm(_referral(), "ORDOK", "MRNOK", "MSGOK-1"))
    assert result.accepted and result.code == "AA" and result.error is None
    assert (result.host, result.port) == (ris_server["host"], ris_server["port"])


def test_send_order_connection_refused(ris_down):
    result = hl7.send_order("MSH|x")
    assert result.code is None and not result.accepted
    assert result.error == f"connection refused (127.0.0.1:{ris_down['port']})"


def _one_shot_server(reply: bytes | None):
    """Accept one connection; send `reply` and close, or (None) never answer."""
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    done = threading.Event()

    def run():
        conn, _ = srv.accept()
        conn.recv(65536)
        if reply is not None:
            conn.sendall(reply)
            conn.close()
        else:
            done.wait(5)
            conn.close()
        srv.close()

    threading.Thread(target=run, daemon=True).start()
    return srv.getsockname()[1], done


def test_send_order_timeout_is_clean():
    port, done = _one_shot_server(None)
    try:
        result = hl7.send_order("MSH|x", host="127.0.0.1", port=port, timeout=0.3)
    finally:
        done.set()
    assert result.code is None
    assert result.error.startswith("timed out after 0.3s")


@pytest.mark.parametrize("reply,expect", [
    (b"\x0bthis is not hl7\x1c\r", "unparseable ACK"),
    (b"", "no ACK from RIS"),
])
def test_send_order_garbage_is_clean(reply, expect):
    port, _ = _one_shot_server(reply)
    result = hl7.send_order("MSH|x", host="127.0.0.1", port=port, timeout=2)
    assert result.code is None
    assert expect in result.error


def test_send_order_bad_port_env(monkeypatch):
    monkeypatch.setenv("RIS_MLLP_PORT", "not-a-port")
    result = hl7.send_order("MSH|x")
    assert result.code is None and "RIS_MLLP_PORT" in result.error
