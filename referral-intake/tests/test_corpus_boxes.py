"""Box recording in the corpus generator.

These coordinates are what the review UI draws its highlight from, so they have
to survive the skew that degrade() applies after the page is drawn.
"""
import math

import pytest

from corpus.generate_faxes import H, W, _drawn_forms, rotate_boxes, value_boxes


class FakeFont:
    """Fixed-width metrics, so expected geometry is arithmetic."""

    def getlength(self, text):
        return 10.0 * len(text)

    def getmetrics(self):
        return (20, 5)


def test_value_is_located_within_a_longer_string():
    # template_c draws several fields on one line: "INS: Meridian   ID: MH123"
    records = [("INS: Meridian   ID: MH123", FakeFont(), 100.0, 400.0)]
    boxes = value_boxes(records, {"member_id": "MH123"})
    box = boxes["member_id"]
    # "MH123" starts 20 characters in, so 200px past the draw origin.
    assert box["left"] == pytest.approx((100 + 200) / W)
    assert box["width"] == pytest.approx(50 / W)
    assert box["top"] == pytest.approx(400 / H)
    assert box["height"] == pytest.approx(25 / H)


def test_a_value_that_was_never_drawn_has_no_box():
    # patient_address is absent from two of the three templates.
    boxes = value_boxes([("PATIENT: Ramirez", FakeFont(), 90.0, 220.0)],
                        {"patient_address": "12 Elm St"})
    assert boxes == {}


def test_drawn_forms_cover_the_template_variations():
    assert _drawn_forms("patient_sex", "F")[0] == "Female"     # template_b spells it out
    assert _drawn_forms("urgency", "stat")[0] == "STAT"        # drawn uppercased
    assert _drawn_forms("icd10_codes", ["A1", "B2"])[0] == "A1, B2"
    assert _drawn_forms("cpt_code", None) == []


def test_zero_angle_leaves_boxes_untouched():
    boxes = {"cpt_code": {"left": 0.1, "top": 0.2, "width": 0.05, "height": 0.01}}
    assert rotate_boxes(boxes, 0) == boxes


def test_a_box_at_the_page_centre_does_not_move():
    box = {"left": 0.5 - 0.01, "top": 0.5 - 0.01, "width": 0.02, "height": 0.02}
    moved = rotate_boxes({"f": box}, 3.0)["f"]
    assert moved["left"] + moved["width"] / 2 == pytest.approx(0.5, abs=1e-9)
    assert moved["top"] + moved["height"] / 2 == pytest.approx(0.5, abs=1e-9)


def test_box_centre_follows_the_rotation_of_the_page():
    # Image.rotate turns content counter-clockwise on screen, which moves a
    # source point by the clockwise matrix in image coordinates. Verified
    # against a rendered marker; this pins the sign so it cannot silently flip.
    angle = 3.0
    box = {"left": 0.2, "top": 0.3, "width": 0.0, "height": 0.0}
    moved = rotate_boxes({"f": box}, angle)["f"]

    theta = math.radians(angle)
    dx, dy = 0.2 * W - W / 2, 0.3 * H - H / 2
    expected_x = ((W / 2) + dx * math.cos(theta) + dy * math.sin(theta)) / W
    expected_y = ((H / 2) - dx * math.sin(theta) + dy * math.cos(theta)) / H

    assert moved["left"] == pytest.approx(expected_x)
    assert moved["top"] == pytest.approx(expected_y)


def test_rotation_keeps_boxes_on_the_page():
    boxes = {f"f{i}": {"left": x, "top": y, "width": 0.05, "height": 0.02}
             for i, (x, y) in enumerate([(0.05, 0.05), (0.9, 0.05), (0.05, 0.95), (0.9, 0.95)])}
    for angle in (-3.0, 3.0):
        for box in rotate_boxes(boxes, angle).values():
            assert -0.05 < box["left"] < 1.05
            assert -0.05 < box["top"] < 1.05
