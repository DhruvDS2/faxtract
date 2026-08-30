"""Extraction entry point.

Two engines answer the same contract -- given a PDF, return a Referral and a
usage dict. EXTRACTOR picks which one runs:

    textract  Amazon Textract Queries (default). Per-field confidence and the
              bounding box each value was read from.
    claude    Claude vision. Per-field confidence is the model's own estimate
              and there is no geometry, so the review UI cannot point at source.
    fixture   Replays corpus ground truth with real boxes and fabricated
              confidence. No cloud calls, no cost. For UI work and demos only;
              the eval harness refuses it.

The rasterization helpers live here rather than in either engine because the
Tesseract baseline and both engines all need them.
"""
import base64
import glob
import io
import os
import shutil

ENGINES = ("textract", "claude", "fixture")


def poppler_dir():
    """Locate Poppler's binaries, or None to let pdf2image search PATH.

    pdf2image shells out to pdftoppm and pdfinfo. Homebrew and apt put those on
    PATH; the Windows build is a portable archive that winget unpacks without
    registering anything, so find it here rather than make everyone who clones
    the repo edit their PATH. POPPLER_PATH overrides the search.
    """
    configured = os.getenv("POPPLER_PATH")
    if configured:
        return configured
    if shutil.which("pdftoppm"):
        return None
    patterns = [
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\*Poppler*\poppler-*\Library\bin"),
        r"C:\Program Files\poppler*\Library\bin",
    ]
    for pattern in patterns:
        for candidate in sorted(glob.glob(pattern), reverse=True):
            if os.path.exists(os.path.join(candidate, "pdftoppm.exe")):
                return candidate
    return None


def pdf_to_images(pdf_path, dpi=200):
    from pdf2image import convert_from_path
    return convert_from_path(str(pdf_path), dpi=dpi, poppler_path=poppler_dir())


def pdf_page_count(pdf_path):
    from pdf2image import pdfinfo_from_path
    return pdfinfo_from_path(str(pdf_path), poppler_path=poppler_dir())["Pages"]


def image_to_b64(img):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def ocr_baseline(pdf_path):
    """Tesseract baseline. Kept so the eval harness can show the delta."""
    import pytesseract
    return "\n".join(pytesseract.image_to_string(img) for img in pdf_to_images(pdf_path, dpi=300))


def engine_name():
    return os.getenv("EXTRACTOR", "textract").strip().lower()


def extract(pdf_path):
    engine = engine_name()
    if engine == "textract":
        from app.extract_textract import extract as run
    elif engine == "claude":
        from app.extract_claude import extract as run
    elif engine == "fixture":
        from app.extract_fixture import extract as run
    else:
        raise ValueError(f"EXTRACTOR={engine!r} is not one of {ENGINES}")
    return run(pdf_path)
