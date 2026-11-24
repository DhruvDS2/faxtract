"""ris/: the MLLP listener (env, fault injection, one shared store) and the MCP tools."""
import asyncio
import json
from datetime import date

from app import hl7
from app.models import Referral
from ris import server, store


def _orm(last_name="Halloran", order_id="ORD1", message_id="MSG1-1"):
    r = Referral(patient_first_name="Clara", patient_last_name=last_name, patient_dob=date(1959, 12, 16),
                 cpt_code="74177", icd10_codes=["R19.00"])
    return hl7.build_orm(r, order_id, "MRN1", message_id)


def test_listener_stores_order_in_shared_store(ris_server):
    result = hl7.send_order(_orm())
    assert result.code == "AA"
    orders = store.load()  # ris/store.py reads the same RIS_STORE_PATH the listener wrote
    assert orders["ORD1"]["patient_last_name"] == "Halloran"
    assert orders["ORD1"]["dob"] == "19591216"
    assert orders["ORD1"]["message_id"] == "MSG1-1"
    assert ris_server["store"].exists()


def test_fault_last_names_answer_ae_and_store_nothing(ris_server, monkeypatch):
    monkeypatch.setenv("RIS_FAULT_LAST_NAMES", " smith , HALLORAN")
    result = hl7.send_order(_orm(order_id="ORD2", message_id="MSG2-1"))
    assert result.code == "AE"
    assert result.text == "simulated RIS rejection"
    assert "MSA|AE|MSG2-1|simulated RIS rejection" in result.raw
    assert "ORD2" not in store.load()
    # other names still go through
    assert hl7.send_order(_orm(last_name="Okafor", order_id="ORD3")).code == "AA"


def test_malformed_and_wrong_type_messages():
    assert hl7.parse_ack(server.handle_message("MSH|^~\\&|A|B|C|D|x||ORM^O01|M9|P|2.5.1")) == \
        ("AE", "missing required segment PID,ORC,OBR")
    assert hl7.parse_ack(server.handle_message("MSH|^~\\&|A|B|C|D|x||ADT^A01|M9|P|2.5.1"))[0] == "AR"
    assert hl7.parse_ack(server.handle_message("PID|nothing"))[0] == "AR"


def test_listen_address_from_env(monkeypatch):
    monkeypatch.setenv("RIS_MLLP_HOST", "127.0.0.2")
    monkeypatch.setenv("RIS_MLLP_PORT", "2601")
    assert server.listen_address() == ("127.0.0.2", 2601)
    monkeypatch.delenv("RIS_MLLP_HOST")
    monkeypatch.delenv("RIS_MLLP_PORT")
    assert server.listen_address() == ("127.0.0.1", 2575)


def test_server_has_no_private_store_copy():
    # the listener goes through ris/store.py; it must not re-implement load/save
    assert not hasattr(server, "load_orders") and not hasattr(server, "save_orders")
    assert server.store is store


def _tool_result(result):
    assert not result.is_error, result
    if result.structured_content is not None and "result" in result.structured_content:
        return result.structured_content["result"]
    return json.loads(result.content[0].text) if result.content else None


def test_mcp_tools_against_temp_store(ris_server, tmp_path, monkeypatch):
    from ris.mcp_server import mcp

    assert hl7.send_order(_orm(order_id="ORDMLLP")).code == "AA"  # placed over MLLP

    async def run():
        names = {t.name for t in await mcp.list_tools()}
        assert names == {"search_patient", "get_orders", "get_order", "create_order", "update_coverage"}
        patients = _tool_result(await mcp.call_tool("search_patient", {"last_name": "halloran"}))
        assert patients == [{"mrn": "MRN1", "last_name": "Halloran", "first_name": "Clara", "dob": "19591216"}]
        assert _tool_result(await mcp.call_tool("search_patient", {"last_name": "Halloran",
                                                                   "dob": "1959-12-16"}))
        assert _tool_result(await mcp.call_tool("search_patient", {"last_name": "Halloran",
                                                                   "dob": "1960-01-01"})) == []
        orders = _tool_result(await mcp.call_tool("get_orders", {"mrn": "MRN1"}))
        assert [o["order_id"] for o in orders] == ["ORDMLLP"]
        detail = _tool_result(await mcp.call_tool("get_order", {"order_id": "ORDMLLP"}))
        assert detail["cpt"] == "74177"
        assert _tool_result(await mcp.call_tool("get_order", {"order_id": "NOPE"})) is None
        created = _tool_result(await mcp.call_tool("create_order", {
            "mrn": "MRN2", "last_name": "Okafor", "first_name": "Ada", "dob": "1970-02-03",
            "cpt": "72148", "description": "MRI lumbar spine"}))
        assert created["dob"] == "19700203" and created["order_id"] not in ("ORDMLLP",)
        cov = _tool_result(await mcp.call_tool("update_coverage", {"mrn": "MRN1", "payor": "Northgate Plan",
                                                                   "member_id": "NG-1"}))
        assert cov["orders_updated"] == 1
        return created["order_id"]

    new_id = asyncio.run(run())
    final = json.loads(ris_server["store"].read_text())
    assert set(final) == {"ORDMLLP", new_id}       # both sides wrote the one store
    assert final["ORDMLLP"]["payor"] == "Northgate Plan"
