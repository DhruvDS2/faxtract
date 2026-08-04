import base64
import io
import json
import os
from pathlib import Path

import anthropic
from pdf2image import convert_from_path

from app.models import Referral

MODEL = "claude-sonnet-4-6"

FIELDS = [
    "patient_first_name", "patient_last_name", "patient_dob", "patient_sex",
    "patient_phone", "patient_address", "referring_provider_name",
    "referring_provider_npi", "referring_practice", "requested_study",
    "laterality", "cpt_code", "icd10_codes", "clinical_indication",
    "urgency", "payor_name", "member_id", "group_id", "order_date",
]

PROMPT = f"""You are reading a faxed radiology referral. The scan is low quality: 1-bit,
skewed, noisy, sometimes with a cover sheet as the first page.

Extract these fields: {", ".join(FIELDS)}

Rules:
- Return null for any field you cannot read. Do not infer or guess a plausible value.
- patient_dob and order_date as YYYY-MM-DD.
- patient_sex as M, F, or U.
- laterality as left, right, bilateral, or n/a.
- urgency as routine, urgent, or stat.
- icd10_codes as a list of strings.
- cpt_code as the 5 digit code only.

Also return a "confidence" object with a score from 0.0 to 1.0 for every field above.
Score confidence on legibility only. A value you can read clearly is high confidence
even if it looks unusual. A value you are reconstructing from partial characters is low.

Return only JSON. No prose, no markdown fences.
"""


def pdf_to_images(pdf_path, dpi=200):
    return convert_from_path(str(pdf_path), dpi=dpi)


def image_to_b64(img):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def ocr_baseline(pdf_path):
    """Tesseract baseline. Kept so the eval harness can show the delta."""
    import pytesseract
    return "\n".join(pytesseract.image_to_string(img) for img in pdf_to_images(pdf_path, dpi=300))


_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def _strip_fences(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def _to_referral(data) -> Referral:
    conf = data.pop("confidence", {}) or {}
    conf = {k: float(v) for k, v in conf.items() if isinstance(v, (int, float))}

    clean = {k: v for k, v in data.items() if v not in ("", None)}

    sex = clean.get("patient_sex")
    if isinstance(sex, str):
        s = sex.strip().upper()
        clean["patient_sex"] = "M" if s.startswith("M") else "F" if s.startswith("F") else "U"
    for field in ("laterality", "urgency"):
        if isinstance(clean.get(field), str):
            clean[field] = clean[field].strip().lower()

    return Referral(**clean, confidence=conf)


def extract(pdf_path) -> tuple[Referral, dict]:
    pages = pdf_to_images(pdf_path)
    content = [
        {"type": "image",
         "source": {"type": "base64", "media_type": "image/png", "data": image_to_b64(img)}}
        for img in pages
    ]
    content.append({"type": "text", "text": PROMPT})

    response = _get_client().messages.create(
        model=MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": content}],
    )

    raw = response.content[0].text
    Path(pdf_path).with_suffix(".raw.json").write_text(raw)

    data = json.loads(_strip_fences(raw))
    referral = _to_referral(data)

    usage = {"input_tokens": response.usage.input_tokens,
             "output_tokens": response.usage.output_tokens}
    return referral, usage
