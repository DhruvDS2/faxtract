"""PATCH coercion: turn what a reviewer typed into a valid Referral, or say per
field why not (docs/CONTRACTS.md §5).

Every value goes through app.models.Referral, so a corrected record has the
same types as an extracted one: a date is a date (never a str that reaches
hl7.build_orm's strftime), icd10_codes is a list of codes (never a str that
becomes one DG1 per character).

    patient_dob, order_date   YYYY-MM-DD or MM/DD/YYYY
    icd10_codes               a list, or one string split on , ; or whitespace; uppercased
    ""                        null (an empty list for icd10_codes)
    confidence, boxes         not editable
    anything else unknown     rejected
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from pydantic import ValidationError

from app.contracts import EDITABLE_FIELDS, FieldError
from app.models import Correction, Referral

DATE_FIELDS = ("patient_dob", "order_date")
NOT_EDITABLE = ("confidence", "boxes")
_ICD_SPLIT = re.compile(r"[,;\s]+")
_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")
_US = re.compile(r"\d{1,2}/\d{1,2}/\d{4}")
# Literal-typed fields: accept any case the reviewer types
_LOWER = ("laterality", "urgency")
_UPPER = ("patient_sex",)


class PatchError(ValueError):
    """The patch cannot be applied; .errors has one FieldError per bad field."""

    def __init__(self, errors: list[FieldError]):
        self.errors = errors
        super().__init__("; ".join(f"{e.field}: {e.message}" for e in errors))


class _Bad(ValueError):
    pass


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        raise _Bad("expected a date as YYYY-MM-DD or MM/DD/YYYY")
    text = value.strip()
    if not text:
        return None
    try:
        if _ISO.fullmatch(text):
            return date.fromisoformat(text)
        if _US.fullmatch(text):
            return datetime.strptime(text, "%m/%d/%Y").date()
    except ValueError:
        raise _Bad(f"{text!r} is not a real calendar date") from None
    raise _Bad(f"{text!r} is not a date; use YYYY-MM-DD or MM/DD/YYYY")


def _parse_icd(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, (list, tuple)):
        items = list(value)
    else:
        raise _Bad("expected a list of codes or a string like 'M54.16, M51.26'")
    codes: list[str] = []
    for item in items:
        if not isinstance(item, str):
            raise _Bad(f"{item!r} is not a code string")
        for code in _ICD_SPLIT.split(item):
            code = code.strip().upper()
            if code and code not in codes:
                codes.append(code)
    return codes


def _parse_text(field: str, value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        raise _Bad("expected text")
    if isinstance(value, (int, float)):
        value = str(value)  # e.g. an NPI or member id typed as a number
    if not isinstance(value, str):
        raise _Bad("expected text")
    value = value.strip()
    if not value:
        return None
    if field in _LOWER:
        return value.lower()
    if field in _UPPER:
        return value.upper()
    return value


def normalize(field: str, value: Any) -> Any:
    if field in DATE_FIELDS:
        return _parse_date(value)
    if field == "icd10_codes":
        return _parse_icd(value)
    return _parse_text(field, value)


def _comparable(referral: Referral, field: str) -> Any:
    return referral.model_dump(mode="json", include={field}).get(field)


def as_text(value: Any) -> str | None:
    """How a field value is written into a Correction."""
    if value is None:
        return None
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) or None
    return str(value)


def apply_patch(referral: Referral, fields: dict[str, Any]) -> tuple[Referral, list[str]]:
    """Return (corrected referral, changed field names). Raises PatchError.

    Changed fields get confidence 1.0 (a human typed them). Unchanged values are
    not counted as changes even if they were sent."""
    if not isinstance(fields, dict) or not fields:
        raise PatchError([FieldError(field="fields", message="name at least one field to change")])

    errors: list[FieldError] = []
    updates: dict[str, Any] = {}
    for name, value in fields.items():
        if name in NOT_EDITABLE:
            errors.append(FieldError(field=name, message=f"{name} is not editable"))
            continue
        if name not in EDITABLE_FIELDS:
            errors.append(FieldError(field=name, message="unknown field"))
            continue
        try:
            updates[name] = normalize(name, value)
        except _Bad as exc:
            errors.append(FieldError(field=name, message=str(exc)))
    if errors:
        raise PatchError(errors)

    data = referral.model_dump()
    data.update(updates)
    try:
        corrected = Referral.model_validate(data)
    except ValidationError as exc:
        seen: dict[str, str] = {}
        for err in exc.errors():
            field = str(err["loc"][0]) if err.get("loc") else "fields"
            seen.setdefault(field, err["msg"])
        raise PatchError([FieldError(field=f, message=m) for f, m in seen.items()]) from None

    changed = [f for f in updates if _comparable(corrected, f) != _comparable(referral, f)]
    if changed:
        confidence = dict(corrected.confidence)
        for f in changed:
            confidence[f] = 1.0
        corrected = corrected.model_copy(update={"confidence": confidence})
    return corrected, changed


def corrections_for(referral_id: str, before: Referral, after: Referral,
                    changed: list[str]) -> list[Correction]:
    from app.contracts import utcnow

    now = utcnow()
    return [
        Correction(
            referral_id=referral_id,
            field=f,
            original_value=as_text(_comparable(before, f)),
            corrected_value=as_text(_comparable(after, f)),
            original_confidence=before.confidence.get(f),
            corrected_at=now,
        )
        for f in changed
    ]
