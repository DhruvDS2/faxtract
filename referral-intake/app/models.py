from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Laterality = Literal["left", "right", "bilateral", "n/a"]
Urgency = Literal["routine", "urgent", "stat"]
Severity = Literal["error", "warning"]


class Box(BaseModel):
    """A region of a page, normalized to 0-1 against that page's dimensions.

    Textract returns geometry this way, which means the same numbers overlay
    correctly on any rendering of the page regardless of DPI or zoom. The
    review UI turns them straight into CSS percentages.
    """
    page: int = 0
    left: float
    top: float
    width: float
    height: float


class Referral(BaseModel):
    patient_first_name: str | None = None
    patient_last_name: str | None = None
    patient_dob: date | None = None
    patient_sex: Literal["M", "F", "U"] | None = None
    patient_phone: str | None = None
    patient_address: str | None = None
    referring_provider_name: str | None = None
    referring_provider_npi: str | None = None
    referring_practice: str | None = None
    requested_study: str | None = None
    laterality: Laterality | None = None
    cpt_code: str | None = None
    icd10_codes: list[str] = Field(default_factory=list)
    clinical_indication: str | None = None
    urgency: Urgency = "routine"
    payor_name: str | None = None
    member_id: str | None = None
    group_id: str | None = None
    order_date: date | None = None
    confidence: dict[str, float] = Field(default_factory=dict)
    boxes: dict[str, list[Box]] = Field(default_factory=dict)


class Flag(BaseModel):
    field: str
    severity: Severity
    message: str


class EligibilityResult(BaseModel):
    status: Literal["active_in_network", "active_out_of_network", "terminated", "not_found"]
    payor_name: str | None = None
    plan_name: str | None = None
    deductible_remaining: float | None = None
    coinsurance_percent: float | None = None
    raw_271: str | None = None


class AuthRequirement(BaseModel):
    required: bool
    missing_elements: list[str] = Field(default_factory=list)
    submission_channel: str | None = None
    turnaround_days: int | None = None


class ProcessedReferral(BaseModel):
    id: str
    source_file: str
    referral: Referral
    flags: list[Flag] = Field(default_factory=list)
    eligibility: EligibilityResult | None = None
    auth: AuthRequirement | None = None
    auth_packet_path: str | None = None
    status: Literal["needs_review", "auto_approved", "approved", "rejected", "sent_to_ris"] = "needs_review"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    stage_timings_ms: dict[str, float] = Field(default_factory=dict)
    token_usage: dict[str, int] = Field(default_factory=dict)


class Correction(BaseModel):
    referral_id: str
    field: str
    original_value: str | None
    corrected_value: str | None
    original_confidence: float | None
    corrected_at: datetime = Field(default_factory=datetime.utcnow)
