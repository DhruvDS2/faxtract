"""Textract response handling, exercised against recorded block shapes.

Everything here runs offline. The AWS call is the one part not covered; these
tests pin the parts that turn its response into a Referral the UI can use.
"""
import pytest

from app.extract_textract import answers_from_blocks, build_referral, coerce
from app.models import Box, Referral


def query_blocks(alias, text, confidence, box=None):
    """The QUERY -> QUERY_RESULT block pair Textract returns for one query."""
    answer_id = f"answer-{alias}"
    answer = {"Id": answer_id, "BlockType": "QUERY_RESULT", "Text": text, "Confidence": confidence}
    if box:
        answer["Geometry"] = {"BoundingBox": box}
    query = {
        "Id": f"query-{alias}",
        "BlockType": "QUERY",
        "Query": {"Text": "…?", "Alias": alias},
        "Relationships": [{"Type": "ANSWER", "Ids": [answer_id]}],
    }
    return [query, answer]


BOX = {"Left": 0.12, "Top": 0.34, "Width": 0.2, "Height": 0.03}


def test_answers_are_keyed_by_alias_with_geometry():
    blocks = query_blocks("patient_last_name", "OKONKWO", 98.4, BOX)
    answers = answers_from_blocks(blocks)
    text, confidence, bbox = answers["patient_last_name"]
    assert text == "OKONKWO"
    assert confidence == pytest.approx(0.984)   # Textract reports 0-100, Referral wants 0-1
    assert bbox == BOX


def test_most_confident_answer_wins():
    blocks = query_blocks("cpt_code", "70551", 71.0, BOX)
    rival = {"Id": "answer-rival", "BlockType": "QUERY_RESULT", "Text": "70553", "Confidence": 93.0}
    blocks[0]["Relationships"][0]["Ids"].append("answer-rival")
    blocks.append(rival)
    assert answers_from_blocks(blocks)["cpt_code"][0] == "70553"


def test_query_without_answer_is_absent():
    blocks = [{"Id": "q", "BlockType": "QUERY", "Query": {"Text": "…?", "Alias": "member_id"}}]
    assert answers_from_blocks(blocks) == {}


def test_blank_answers_are_ignored():
    blocks = query_blocks("group_id", "   ", 99.0, BOX)
    assert answers_from_blocks(blocks) == {}


def test_build_referral_maps_box_onto_the_page():
    referral = build_referral({"patient_last_name": ("OKONKWO", 0.98, Box(page=1, **{
        "left": 0.12, "top": 0.34, "width": 0.2, "height": 0.03}))})
    box = referral.boxes["patient_last_name"][0]
    assert (box.page, box.left, box.top) == (1, 0.12, 0.34)
    assert referral.confidence["patient_last_name"] == 0.98


def test_unreadable_values_are_dropped_not_stored_malformed():
    # A CPT code we cannot find in the answer must leave the field empty so
    # validate.py reports it missing rather than passing a bad string downstream.
    referral = build_referral({"cpt_code": ("illegible", 0.4, None)})
    assert referral.cpt_code is None
    assert "cpt_code" not in referral.confidence
    assert "cpt_code" not in referral.boxes


def test_coercions():
    assert coerce("patient_dob", "03/14/1961").isoformat() == "1961-03-14"
    assert coerce("patient_dob", "Mar 14, 1961").isoformat() == "1961-03-14"
    assert coerce("patient_sex", "Female") == "F"
    assert coerce("laterality", "Left knee") == "left"
    assert coerce("laterality", "not stated") == "n/a"
    assert coerce("urgency", "STAT") == "stat"
    assert coerce("urgency", "please expedite") == "urgent"
    assert coerce("cpt_code", "CPT 70551") == "70551"
    assert coerce("icd10_codes", "G43.909, R51") == ["G43.909", "R51"]
    assert coerce("patient_phone", "(503) 555-0142") == "503-555-0142"
    assert coerce("member_id", "n/a") is None


def test_two_digit_years_resolve_to_the_past():
    assert coerce("patient_dob", "3/14/61").isoformat() == "1961-03-14"
    assert coerce("order_date", "3/14/26").isoformat() == "2026-03-14"


def test_boxes_is_not_a_scored_field():
    # scoring.py iterates Referral.model_fields; boxes and confidence are
    # metadata and would otherwise be scored against ground truth.
    from evals.scoring import SCORED_FIELDS
    assert "boxes" not in SCORED_FIELDS
    assert "confidence" not in SCORED_FIELDS
    assert set(SCORED_FIELDS) < set(Referral.model_fields)
