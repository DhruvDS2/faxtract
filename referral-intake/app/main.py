import io
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.extract import pdf_page_count, pdf_to_images
from app.models import Correction, ProcessedReferral
from app.pipeline import process, send_to_ris
from app.auth_packet import build_packet
from app.hl7 import build_orm

PACKETS = Path(__file__).parent.parent / "packets"

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
    return {"count": pdf_page_count(REFERRALS[referral_id].source_file)}


# The corpus writes its PDFs at 200 dpi, so rendering the preview below that
# threw away detail the page actually had. 300 keeps it legible at 4x zoom, and
# greyscale roughly halves the bytes -- a scanned fax has no colour to lose.
PREVIEW_DPI = int(os.getenv("PREVIEW_DPI", "300"))


# Rasterizing at 300 dpi costs about a second and renders every page even when
# only one is asked for, so each page flip used to block on a full re-render.
# Hovering a field whose source sits on another page turns that into a visible
# stall, and a reviewer who moves on before it lands never sees the jump at all.
# Encode once and keep the PNGs -- a page is ~100 KB, against a REFERRALS dict
# that is already unbounded in memory.
PAGE_CACHE: dict[tuple[str, int], list[bytes]] = {}


def _page_pngs(referral_id):
    key = (referral_id, PREVIEW_DPI)
    if key not in PAGE_CACHE:
        encoded = []
        for image in pdf_to_images(REFERRALS[referral_id].source_file, dpi=PREVIEW_DPI):
            buf = io.BytesIO()
            image.convert("L").save(buf, format="PNG", optimize=True)
            encoded.append(buf.getvalue())
        PAGE_CACHE[key] = encoded
    return PAGE_CACHE[key]


@app.get("/referrals/{referral_id}/pages/{page}")
def page_image(referral_id: str, page: int = 0):
    pages = _page_pngs(referral_id)
    idx = max(0, min(page, len(pages) - 1))
    # The render of a given page never changes, so let the browser keep it too
    # and make flipping back and forth free.
    return Response(content=pages[idx], media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


def _retrieve_for(processed):
    from app import rag  # lazy: only load the embedding model when a policy panel is opened
    r = processed.referral
    indication = r.clinical_indication or r.requested_study or ""
    codes = [c for c in [r.cpt_code, *r.icd10_codes] if c]
    if not r.payor_name:
        return {"keywords": [], "results": []}
    return rag.retrieve_3step(indication, codes, r.payor_name, k=3)


def _auth_required(processed):
    return bool(processed.auth and processed.auth.required)


@app.get("/referrals/{referral_id}/policy")
def policy(referral_id: str):
    processed = REFERRALS[referral_id]
    if not _auth_required(processed):
        return {"required": False, "keywords": [], "citations": []}
    out = _retrieve_for(processed)
    return {
        "required": True,
        "keywords": out["keywords"],
        "citations": [
            {"source": Path(ch["source"]).stem, "score": round(float(s), 3), "text": ch["text"]}
            for ch, s in out["results"]
        ],
    }


@app.get("/referrals/{referral_id}/packet")
def packet(referral_id: str):
    processed = REFERRALS[referral_id]
    if not _auth_required(processed):
        return Response(
            content=b"No prior authorization required for this study; no packet generated.",
            media_type="text/plain", status_code=409,
        )
    out = _retrieve_for(processed)
    citations = [{"path": ch["source"], "text": ch["text"]} for ch, _ in out["results"]]
    PACKETS.mkdir(exist_ok=True)
    path = PACKETS / f"auth_{processed.referral.member_id or referral_id}.pdf"
    build_packet(processed.referral, processed.eligibility, citations, path)
    return Response(content=path.read_bytes(), media_type="application/pdf")


@app.get("/referrals/{referral_id}/order")
def order(referral_id: str):
    processed = REFERRALS[referral_id]
    rid = referral_id.upper()
    msg = build_orm(processed.referral, "ORD" + rid, "MRN" + rid, "MSG" + rid)
    return {"message": msg}


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
