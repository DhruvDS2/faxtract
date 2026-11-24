"""Field boxes in the corpus ground truth: they must sit on the printed value after
the page is skewed and downscaled, because the review UI draws its highlight from them."""
import json

import numpy as np
import pytest
from PIL import ImageDraw

from corpus.generate_faxes import TRUTH_FIELDS, BOX_PAD_PX, H, W, Sheet, blank, degrade, load_fonts


class ExtremeRng:
    """Stands in for random.Random inside degrade(): every draw takes an end of its
    range, so the page gets the largest skew its level allows (and no scan lines
    across the text)."""

    def __init__(self, sign):
        self.sign = sign

    def uniform(self, a, b):
        return b if self.sign > 0 else a

    def randint(self, a, b):
        return a

    def choice(self, seq):
        return seq[-1]


def _ink_bbox(page, box, margin=30):
    """Bounding box (pixels) of the ink near a normalised box; isolated noise pixels ignored."""
    a = np.asarray(page) < 128
    h, w = a.shape
    x0 = max(int(box["left"] * w) - margin, 0)
    y0 = max(int(box["top"] * h) - margin, 0)
    x1 = min(int((box["left"] + box["width"]) * w) + margin, w)
    y1 = min(int((box["top"] + box["height"]) * h) + margin, h)
    window = a[y0:y1, x0:x1]
    rows = np.nonzero(window.sum(axis=1) >= 3)[0]
    cols = np.nonzero(window.sum(axis=0) >= 3)[0]
    assert rows.size and cols.size, "no ink near the box"
    return x0 + cols[0], y0 + rows[0], x0 + cols[-1] + 1, y0 + rows[-1] + 1


@pytest.mark.parametrize("level", ["clean", "moderate", "hard"])
@pytest.mark.parametrize("sign", [1, -1])
def test_boxes_follow_skew_and_downscale(level, sign):
    fonts = load_fonts()
    sheet = Sheet()
    # far from the page centre, where a rotation moves things most, with no other
    # ink nearby (a tagged value after a label is covered by the test below)
    sheet.text((90, 120), [("referring_provider_npi", "8006945546")], fonts["body"])
    sheet.text((1150, 2050), [("member_id", "MH101226916")], fonts["body"])
    page, warp = degrade(sheet.img, ExtremeRng(sign), level)
    boxes = sheet.boxes_after(warp, page_index=0)
    assert set(boxes) == {"referring_provider_npi", "member_id"}

    w, h = page.size
    scale = w / W
    slack = BOX_PAD_PX * scale + 4  # pad + glyph side bearing + resampling, in pixels
    for name, box in boxes.items():
        bx0, by0 = box["left"] * w, box["top"] * h
        bx1, by1 = bx0 + box["width"] * w, by0 + box["height"] * h
        ix0, iy0, ix1, iy1 = _ink_bbox(page, box)
        # the box holds the printed value ...
        assert bx0 <= ix0 + 1.5 and by0 <= iy0 + 1.5 and ix1 <= bx1 + 1.5 and iy1 <= by1 + 1.5, (name, level)
        # ... and not much else
        assert ix0 - bx0 <= slack and iy0 - by0 <= slack and bx1 - ix1 <= slack and by1 - iy1 <= slack, (name, level)


def test_tagged_text_draws_exactly_like_plain_text():
    fonts = load_fonts()
    plain, d = blank()
    d.text((90, 220), "PATIENT: Whitfield, Rowan", font=fonts["body"], fill=0)
    sheet = Sheet()
    sheet.text((90, 220), ["PATIENT: ", ("patient_last_name", "Whitfield"), ", ",
                           ("patient_first_name", "Rowan")], fonts["body"])
    assert sheet.img.tobytes() == plain.tobytes()

    last, first = sheet.regions["patient_last_name"], sheet.regions["patient_first_name"]
    line = ImageDraw.Draw(plain).textbbox((90, 220), "PATIENT: Whitfield, Rowan", font=fonts["body"])
    assert line[0] < last[0] < last[2] < first[0] < first[2] <= line[2] + 1


def test_a_value_is_boxed_where_it_is_printed_not_where_its_text_recurs():
    """'M' (sex) also occurs in 'IMAGING' and the clinic name; the box must be on 'SEX: M'."""
    fonts = load_fonts()
    sheet = Sheet()
    sheet.text((90, 132), "IMAGING REQUISITION", fonts["head"])
    sheet.text((90, 266), ["PH: ", ("patient_phone", "(486) 914-5342")], fonts["body"])
    sheet.text((1000, 266), ["SEX: ", ("patient_sex", "M")], fonts["body"])
    page, warp = degrade(sheet.img, ExtremeRng(1), "clean")
    boxes = sheet.boxes_after(warp, page_index=0)
    assert abs(boxes["patient_sex"]["top"] - boxes["patient_phone"]["top"]) < 0.01
    assert boxes["patient_sex"]["left"] > 1000 / W


@pytest.fixture(scope="module")
def truth(corpus):
    return json.loads((corpus / "ground_truth.json").read_text())


def test_every_printed_field_has_a_sane_box_on_the_referral_page(truth):
    assert len(truth) == 60
    for name, row in truth.items():
        printed = [f for f in TRUTH_FIELDS if row[f] is not None]
        assert sorted(row["boxes"]) == sorted(printed), name
        for field, box in row["boxes"].items():
            assert set(box) == {"page", "left", "top", "width", "height"}
            assert box["page"] == row["pages"] - 1, (name, field)  # a cover sheet comes first
            assert 0 <= box["left"] < box["left"] + box["width"] <= 1, (name, field)
            assert 0 <= box["top"] < box["top"] + box["height"] <= 1, (name, field)
            assert box["height"] < 0.05, (name, field)


def test_template_c_laterality_box_is_the_ticked_checkbox(truth):
    lefts = {}
    for row in truth.values():
        if row["template"] == "template_c":
            lefts.setdefault(row["laterality"], set()).add(round(row["boxes"]["laterality"]["left"], 1))
    # the four options sit 300 px apart starting at x=100 on a 1700 px page
    expected = {"left": 0.1, "right": 0.2, "bilateral": 0.4, "n/a": 0.6}
    for value, seen in lefts.items():
        assert all(abs(x - expected[value]) <= 0.1 for x in seen), (value, seen)


def test_boxes_land_on_ink_in_the_rendered_pdfs(truth, corpus):
    from pdf2image import convert_from_path

    picks = {}
    for name, row in sorted(truth.items()):  # every template x degradation, plus a cover-sheet fax
        picks.setdefault((row["template"], row["degradation"]), name)
        if row["pages"] == 2:
            picks.setdefault("cover", name)
    for name in picks.values():
        row = truth[name]
        page = convert_from_path(str(corpus / name), dpi=100, grayscale=True)[-1]
        a = np.asarray(page) < 128
        h, w = a.shape
        for field, box in row["boxes"].items():
            crop = a[int(box["top"] * h): int((box["top"] + box["height"]) * h) + 1,
                     int(box["left"] * w): int((box["left"] + box["width"]) * w) + 1]
            assert crop.size and crop.mean() > 0.04, (name, field, float(crop.mean()) if crop.size else 0)
