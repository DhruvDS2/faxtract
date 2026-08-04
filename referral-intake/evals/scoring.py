import re
import unicodedata

from app.models import Referral
from app.validate import is_auto_approvable, validate

SCORED_FIELDS = [f for f in Referral.model_fields if f != "confidence"]
CRITICAL_FIELDS = ["patient_first_name", "patient_last_name", "patient_dob",
                   "cpt_code", "laterality", "icd10_codes", "member_id", "payor_name"]


def normalize(value):
    if value is None:
        return ""
    s = unicodedata.normalize("NFKD", str(value)).lower().strip()
    return re.sub(r"[^a-z0-9]", "", s)


def field_matches(field, predicted, actual):
    if field == "icd10_codes":
        return sorted(predicted or []) == sorted(actual or [])
    if field in ("patient_dob", "order_date"):
        return str(predicted or "")[:10] == str(actual or "")[:10]
    return normalize(predicted) == normalize(actual)


def _any_critical_field_wrong(referral, gt):
    for field in CRITICAL_FIELDS:
        if field in gt and not field_matches(field, getattr(referral, field), gt[field]):
            return True
    return False


def score_extraction(results, ground_truth):
    scores = {}
    for field in SCORED_FIELDS:
        correct = total = 0
        for r in results:
            gt = ground_truth.get(r["file"])
            if not gt or field not in gt:
                continue
            total += 1
            if field_matches(field, getattr(r["referral"], field), gt[field]):
                correct += 1
        if total:
            scores[field] = {"correct": correct, "total": total, "accuracy": correct / total}
    return scores


def sweep_thresholds(results, ground_truth, start=0.50, stop=0.95, step=0.05):
    rows = []
    n = len(results)
    steps = int(round((stop - start) / step)) + 1
    for i in range(steps):
        t = round(start + i * step, 2)
        auto = wrong = 0
        for r in results:
            if is_auto_approvable(validate(r["referral"], t)):
                auto += 1
                if _any_critical_field_wrong(r["referral"], ground_truth.get(r["file"], {})):
                    wrong += 1
        rows.append({
            "threshold": t,
            "auto_count": auto,
            "false_count": wrong,
            "auto_approval_rate": auto / n if n else 0.0,
            "false_approval_rate": wrong / n if n else 0.0,
            "false_rate_of_auto": wrong / auto if auto else 0.0,
        })
    return rows
