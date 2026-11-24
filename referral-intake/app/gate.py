"""The auto-approve gate, shared by both pipelines so the benchmark compares
orchestration, not decision rules. Identical to v1's rule in app/pipeline.py:
no validation flags at the threshold, coverage active, no missing auth elements.
"""
from app.models import AuthRequirement, EligibilityResult, Flag


def review_reasons(flags: list[Flag], eligibility: EligibilityResult | None,
                   auth: AuthRequirement | None) -> list[str]:
    """Why this referral needs a human. Empty list == auto-approve."""
    reasons = [f"{f.field}: {f.message}" for f in flags]
    if eligibility is None:
        reasons.append("eligibility: not checked")
    elif eligibility.status not in ("active_in_network", "active_out_of_network"):
        reasons.append(f"eligibility: {eligibility.status.replace('_', ' ')}")
    if auth is not None and auth.missing_elements:
        reasons.append("prior auth: missing " + ", ".join(auth.missing_elements))
    return reasons


def blocking_flags(flags: list[Flag]) -> list[Flag]:
    """Flags that make an approve a 409: error severity. Warnings are the reviewer's call."""
    return [f for f in flags if f.severity == "error"]
