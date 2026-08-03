import re
import unicodedata


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


def score_extraction(results, ground_truth):
    """Per field: correct / total. Report per field, not just an average -
    'DOB is 97 percent, member ID is 84 percent, and member ID is where the money is'
    is the sentence you want."""
    raise NotImplementedError


def sweep_thresholds(results, ground_truth, start=0.50, stop=0.95, step=0.05):
    """At each threshold report:
      auto_approval_rate  - fraction clearing validation with zero human touch
      false_approval_rate - auto-approved referrals with at least one field wrong

    false_approval_rate is the number that matters. A wrong CPT means a denied
    claim or the wrong study performed."""
    raise NotImplementedError
