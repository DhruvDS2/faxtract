import io
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pdf2image import convert_from_path, pdfinfo_from_path

load_dotenv()

from app.models import Correction, ProcessedReferral
from app.pipeline import process, send_to_ris

app = FastAPI(title="Referral Intake")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

UPLOADS = Path(__file__).parent.parent / "uploads"
UPLOADS.mkdir(exist_ok=True)

REFERRALS: dict[str, ProcessedReferral] = {}
CORRECTIONS: list[Correction] = []


@app.post("/referrals")
async def upload(file: UploadFile):
    dest = UPLOADS / file.filename
    dest.write_bytes(await file.read())
    processed = process(dest)
    REFERRALS[processed.id] = processed
    return processed


@app.get("/referrals")
def list_referrals():
    return sorted(REFERRALS.values(), key=lambda r: min(r.referral.confidence.values(), default=1.0))


@app.get("/referrals/{referral_id}")
def get_referral(referral_id: str):
    return REFERRALS[referral_id]


@app.get("/referrals/{referral_id}/pagecount")
def page_count(referral_id: str):
    info = pdfinfo_from_path(REFERRALS[referral_id].source_file)
    return {"count": info["Pages"]}


@app.get("/referrals/{referral_id}/pages/{page}")
def page_image(referral_id: str, page: int = 0):
    images = convert_from_path(REFERRALS[referral_id].source_file, dpi=150)
    idx = max(0, min(page, len(images) - 1))
    buf = io.BytesIO()
    images[idx].convert("RGB").save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.patch("/referrals/{referral_id}")
def correct(referral_id: str, updates: dict):
    processed = REFERRALS[referral_id]
    for field, value in updates.items():
        original = getattr(processed.referral, field, None)
        CORRECTIONS.append(Correction(
            referral_id=referral_id,
            field=field,
            original_value=str(original) if original is not None else None,
            corrected_value=str(value) if value is not None else None,
            original_confidence=processed.referral.confidence.get(field),
        ))
        setattr(processed.referral, field, value)
        processed.referral.confidence[field] = 1.0
    return processed


@app.post("/referrals/{referral_id}/approve")
def approve(referral_id: str):
    processed = REFERRALS[referral_id]
    processed.status = "approved"
    ok = send_to_ris(processed)
    return {"sent": ok, "referral": processed}


@app.post("/referrals/{referral_id}/reject")
def reject(referral_id: str):
    REFERRALS[referral_id].status = "rejected"
    return REFERRALS[referral_id]


@app.get("/corrections")
def corrections():
    return CORRECTIONS
