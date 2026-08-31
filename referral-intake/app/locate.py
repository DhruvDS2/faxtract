"""Find where each extracted field value sits on the fax, using Tesseract.

Claude vision returns field values + confidence but no coordinates. This runs a
Tesseract OCR pass to get word-level boxes, then matches each extracted value
back to the words on the page -- giving the same hover-highlight source regions
Textract produces natively. Boxes are normalized 0-1 to match the Box schema.
"""

import re

import pytesseract

from app.extract import pdf_to_images
from app.models import Box

# nothing is skipped -- we try to locate every field. Fields whose values don't
# appear literally on the page simply won't get a box (best-effort).
_SKIP = set()

# for short/normalized values (e.g. sex = "F") string-matching fails, so anchor
# to the field's label word and box the matching value sitting next to it.
_LABELS = {"patient_sex": ["sex", "gender"]}


def _locate_by_label(field, value, pages):
    labels = _LABELS.get(field)
    if not labels:
        return None
    target = _alnum(value)
    for pi, words in enumerate(pages):
        anchors = [w for w in words if w["text"] in labels]
        for a in anchors:
            # exact value-word on the same row as, or just below, the label
            near = [w for w in words if w["norm"] == target
                    and (abs(w["top"] - a["top"]) < 0.05 or 0 < w["top"] - a["top"] < 0.06)]
            if near:
                w = min(near, key=lambda w: abs(w["left"] - a["left"]) + abs(w["top"] - a["top"]))
                return Box(page=pi, left=w["left"], top=w["top"], width=w["width"], height=w["height"])
    return None


def _alnum(s):
    """Strip everything but letters/digits, lowercased. So "(315)" -> "315",
    "J98.4" -> "j984" -- lets a value token match a page word regardless of the
    punctuation Tesseract reads around it."""
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _tokens(value):
    return [t for t in re.findall(r"[A-Za-z0-9]+", str(value).lower()) if len(t) >= 3]


def _search_terms(field, value):
    """Claude normalizes some values (sex -> F, dates -> YYYY-MM-DD) so they no
    longer match the page text. Expand those back to what a fax actually shows."""
    v = str(value).strip()
    if field == "patient_sex":
        return {"F": ["female"], "M": ["male"], "U": ["unknown"]}.get(v.upper(), [v])
    if field in ("patient_dob", "order_date") and re.match(r"\d{4}-\d{2}-\d{2}", v):
        y, m, d = v[:10].split("-")
        return [f"{m}/{d}/{y}", f"{int(m)}/{int(d)}/{y}", v, f"{m}-{d}-{y}"]
    return [v]


def _matches(word_norm, tok):
    """A page word matches a value token, comparing punctuation-stripped forms so
    "315" matches the page word "(315)". Exact, or one contains the other (>=3)."""
    if not word_norm:
        return False
    return word_norm == tok or tok in word_norm or word_norm in tok


def _page_words(img):
    """Tesseract word boxes for one page image, normalized to 0-1."""
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    w, h = img.width, img.height
    words = []
    for i, txt in enumerate(data["text"]):
        t = txt.strip()
        if not t or int(data["conf"][i]) < 30:
            continue
        words.append({
            "text": t.lower(), "norm": _alnum(t),
            "left": data["left"][i] / w, "top": data["top"][i] / h,
            "width": data["width"][i] / w, "height": data["height"][i] / h,
        })
    return words


def _union(matched):
    left = min(m["left"] for m in matched)
    top = min(m["top"] for m in matched)
    right = max(m["left"] + m["width"] for m in matched)
    bottom = max(m["top"] + m["height"] for m in matched)
    return left, top, right - left, bottom - top


def locate_boxes(pdf_path, referral, pages=None):
    """Populate referral.boxes by matching each field value to page word boxes.

    `pages` is a list (one per page) of word dicts {text, norm, left, top, width,
    height}, all normalized 0-1. If not given, Tesseract provides them. Passing
    Textract word boxes instead gives the same matching against Claude's values
    but with higher-quality OCR geometry."""
    if pages is None:
        pages = [_page_words(img) for img in pdf_to_images(pdf_path)]

    fields = {k: v for k, v in referral.model_dump().items()
              if v and k not in _SKIP and k not in ("confidence", "boxes")}

    boxes = {}
    for field, value in fields.items():
        # one box per REAL value: list items (icd10_codes) each get their own;
        # a scalar gets one box (best across its normalized-value variants).
        real_vals = value if isinstance(value, list) else [value]
        found = []
        for real in real_vals:
            box = None
            for term in _search_terms(field, real):
                box = _best_box(_tokens(term), pages)
                if box:
                    break
            if box is None:
                box = _locate_by_label(field, real, pages)
            if box:
                found.append(box)
        if found:
            boxes[field] = found

    referral.boxes = boxes
    return referral


def _best_box(toks, pages):
    """The tightest contiguous run of page words matching the value's tokens."""
    if not toks:
        return None
    best = None  # (score, page, matched_words)
    span = len(toks)
    for pi, words in enumerate(pages):
        for i in range(len(words)):
            window = words[i:i + span + 2]
            matched = [wd for wd in window if any(_matches(wd["norm"], t) for t in toks)]
            if matched and (best is None or len(matched) > best[0]):
                best = (len(matched), pi, matched)
    if not best:
        return None
    _, pi, matched = best
    l, t, w, h = _union(matched)
    if w >= 0.9 or h >= 0.5:  # reject page-sized junk boxes
        return None
    return Box(page=pi, left=l, top=t, width=w, height=h)
