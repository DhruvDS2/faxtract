"""Field extraction via Amazon Textract Queries.

Each field is asked as a natural-language question. Textract answers with the
text, a confidence score, and the bounding box on the page it read the answer
from -- which is what lets the review UI point at the source of every value.

Sync AnalyzeDocument accepts at most 15 queries per page, so the 19 fields go
out in two calls per page. Sync also refuses multi-page PDFs, so pages are
rasterized and sent one image at a time. Both constraints are why this walks
pages in a loop rather than handing over the whole PDF.
"""
import io
import os
import re
from datetime import datetime

from app.extract import pdf_to_images
from app.models import Box, Referral

MAX_QUERIES_PER_CALL = 15

# Textract answers questions, not field names. The phrasing matters: these read
# the way the label reads on the fax itself.
QUERIES = [
    ("patient_first_name", "What is the patient first name?"),
    ("patient_last_name", "What is the patient last name?"),
    ("patient_dob", "What is the patient date of birth?"),
    ("patient_sex", "What is the patient sex?"),
    ("patient_phone", "What is the patient phone number?"),
    ("patient_address", "What is the patient home address?"),
    ("referring_provider_name", "What is the name of the referring provider?"),
    ("referring_provider_npi", "What is the referring provider NPI number?"),
    ("referring_practice", "What is the name of the referring practice or clinic?"),
    ("requested_study", "What imaging study is being requested?"),
    ("laterality", "Which side of the body is the requested study for?"),
    ("cpt_code", "What is the CPT code?"),
    ("icd10_codes", "What are the ICD-10 diagnosis codes?"),
    ("clinical_indication", "What is the clinical indication for the exam?"),
    ("urgency", "What is the priority or urgency of this request?"),
    ("payor_name", "What is the name of the insurance plan or payor?"),
    ("member_id", "What is the insurance member ID?"),
    ("group_id", "What is the insurance group number?"),
    ("order_date", "What date was this order signed?"),
]

# Two-digit years are deliberately absent: strptime pivots them at 68, which
# turns a 1961 date of birth into 2061. The regex fallback in _parse_date
# handles them with a pivot that suits birth dates and order dates instead.
DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%d/%m/%Y",
                "%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%Y/%m/%d"]

_client = None


def _get_client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config
        _client = boto3.client(
            "textract",
            region_name=os.getenv("AWS_REGION", "us-east-1"),
            config=Config(retries={"max_attempts": 5, "mode": "standard"}),
        )
    return _client


def _png_bytes(img):
    buf = io.BytesIO()
    img.convert("L").save(buf, format="PNG")
    return buf.getvalue()


def answers_from_blocks(blocks):
    """Map each query alias to its best answer: (text, confidence, bounding box).

    A QUERY block points at its QUERY_RESULT blocks through an ANSWER
    relationship. Textract can return several candidate answers per query; the
    most confident non-empty one wins.
    """
    by_id = {b["Id"]: b for b in blocks}
    out = {}
    for block in blocks:
        if block.get("BlockType") != "QUERY":
            continue
        alias = block.get("Query", {}).get("Alias")
        if not alias:
            continue
        answer_ids = [i for rel in block.get("Relationships", [])
                      if rel.get("Type") == "ANSWER" for i in rel.get("Ids", [])]
        best = None
        for answer_id in answer_ids:
            answer = by_id.get(answer_id)
            if not answer or not (answer.get("Text") or "").strip():
                continue
            if best is None or answer.get("Confidence", 0) > best.get("Confidence", 0):
                best = answer
        if best is not None:
            out[alias] = (best["Text"].strip(),
                          best.get("Confidence", 0.0) / 100.0,
                          best.get("Geometry", {}).get("BoundingBox"))
    return out


def _query_page(image, page_index):
    """Run every query against one page image. Returns {field: (text, conf, box)}."""
    client = _get_client()
    payload = _png_bytes(image)
    found = {}
    calls = 0
    for start in range(0, len(QUERIES), MAX_QUERIES_PER_CALL):
        batch = QUERIES[start:start + MAX_QUERIES_PER_CALL]
        response = client.analyze_document(
            Document={"Bytes": payload},
            FeatureTypes=["QUERIES"],
            QueriesConfig={"Queries": [{"Text": text, "Alias": field} for field, text in batch]},
        )
        calls += 1
        for field, (text, conf, bbox) in answers_from_blocks(response.get("Blocks", [])).items():
            box = None
            if bbox:
                box = Box(page=page_index, left=bbox["Left"], top=bbox["Top"],
                          width=bbox["Width"], height=bbox["Height"])
            found[field] = (text, conf, box)
    return found, calls


def _parse_date(text):
    cleaned = re.sub(r"[^0-9A-Za-z/,\- ]", "", text).strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    match = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", cleaned)
    if match:
        month, day, year = (int(g) for g in match.groups())
        if year < 100:
            # Anything past the pivot reads as last century: these are dates of
            # birth and order dates, so a future year is always a misread.
            year += 1900 if year > 30 else 2000
        try:
            return datetime(year, month, day).date()
        except ValueError:
            return None
    return None


def coerce(field, text):
    """Textract answers are raw strings. Turn them into what Referral expects.

    Returning None drops the field, which is deliberate: a value we cannot read
    into the right shape is not a value, and validate.py should see it missing
    rather than see a malformed string that passes as present.
    """
    text = (text or "").strip()
    if not text or text.lower() in ("n/a", "na", "none", "unknown", "-"):
        return None

    if field in ("patient_dob", "order_date"):
        return _parse_date(text)
    if field == "patient_sex":
        head = text.upper()
        return "M" if head.startswith("M") else "F" if head.startswith("F") else "U"
    if field == "laterality":
        low = text.lower()
        for option in ("bilateral", "left", "right"):
            if option in low:
                return option
        return "n/a"
    if field == "urgency":
        low = text.lower()
        if "stat" in low or "emerg" in low:
            return "stat"
        if "urgent" in low or "expedite" in low:
            return "urgent"
        return "routine"
    if field == "cpt_code":
        match = re.search(r"\b(\d{5})\b", text)
        return match.group(1) if match else None
    if field == "referring_provider_npi":
        digits = re.sub(r"\D", "", text)
        return digits or None
    if field == "icd10_codes":
        codes = re.findall(r"\b([A-Z]\d{2}(?:\.[A-Z0-9]{1,4})?)\b", text.upper())
        return codes or None
    if field == "patient_phone":
        digits = re.sub(r"\D", "", text)
        if len(digits) == 10:
            return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
        return text
    return text


def build_referral(best):
    """Turn {field: (text, confidence, box)} into a Referral.

    Split out from extract() so the coercion and confidence/box bookkeeping can
    be tested against recorded Textract responses without calling AWS.
    """
    values, confidence, boxes = {}, {}, {}
    for field, (text, conf, box) in best.items():
        value = coerce(field, text)
        if value in (None, [], ""):
            continue
        values[field] = value
        confidence[field] = round(conf, 4)
        if box is not None:
            boxes[field] = [box]
    return Referral(**values, confidence=confidence, boxes=boxes)


def extract(pdf_path) -> tuple[Referral, dict]:
    pages = pdf_to_images(pdf_path)

    # A field can be answered on more than one page (cover sheet plus body).
    # Keep the most confident answer and the box that goes with it.
    best: dict[str, tuple[str, float, Box | None]] = {}
    calls = 0
    for index, image in enumerate(pages):
        found, page_calls = _query_page(image, index)
        calls += page_calls
        for field, candidate in found.items():
            if field not in best or candidate[1] > best[field][1]:
                best[field] = candidate

    referral = build_referral(best)
    usage = {"textract_pages": len(pages), "textract_calls": calls}
    return referral, usage
