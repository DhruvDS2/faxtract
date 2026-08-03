import time
import uuid

from app.auth_packet import auth_requirement
from app.edi import build_270, parse_271
from app.extract import extract
from app.hl7 import ack_is_accept, build_orm, send_mllp
from app.models import ProcessedReferral
from app.payor import respond
from app.validate import STUDIES, is_auto_approvable, validate

CLINIC_NPI = "1234567893"


def _timed(timings, name, fn, *args, **kwargs):
    t0 = time.perf_counter()
    result = fn(*args, **kwargs)
    timings[name] = (time.perf_counter() - t0) * 1000
    return result


def process(pdf_path, confidence_threshold=0.85) -> ProcessedReferral:
    timings = {}
    referral, usage = _timed(timings, "extract", extract, pdf_path)
    flags = _timed(timings, "validate", validate, referral, confidence_threshold)

    edi_270 = build_270(referral, CLINIC_NPI)
    eligibility = _timed(timings, "eligibility", lambda: parse_271(respond(edi_270)))

    auth = auth_requirement(referral)

    processed = ProcessedReferral(
        id=str(uuid.uuid4())[:8],
        source_file=str(pdf_path),
        referral=referral,
        flags=flags,
        eligibility=eligibility,
        auth=auth,
        stage_timings_ms=timings,
        token_usage=usage,
    )

    clean = is_auto_approvable(flags)
    covered = eligibility.status in ("active_in_network", "active_out_of_network")
    if clean and covered and not auth.missing_elements:
        processed.status = "auto_approved"
    else:
        processed.status = "needs_review"
    return processed


def send_to_ris(processed: ProcessedReferral, host="localhost", port=2575) -> bool:
    order_id = "ORD" + processed.id.upper()
    mrn = "MRN" + processed.id.upper()
    msg = build_orm(processed.referral, order_id, mrn, "MSG" + processed.id.upper())
    ack = send_mllp(msg, host=host, port=port)
    if ack_is_accept(ack):
        processed.status = "sent_to_ris"
        return True
    return False
