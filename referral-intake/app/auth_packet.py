from pathlib import Path

from app.models import AuthRequirement, Referral
from app.validate import PAYORS, STUDIES, match_payor

OUT = Path(__file__).parent.parent / "packets"


def auth_requirement(referral: Referral) -> AuthRequirement:
    payor = match_payor(referral.payor_name)
    study = STUDIES.get(referral.cpt_code or "")
    if not payor or not study:
        return AuthRequirement(required=False)

    required = study["modality"] in payor["auth_required_modalities"]
    missing = []
    if required:
        if "clinical_notes" in payor["auth_packet_requires"] and not referral.clinical_indication:
            missing.append("clinical_notes")
        if "prior_imaging" in payor["auth_packet_requires"]:
            missing.append("prior_imaging")
        if "conservative_treatment_attestation" in payor["auth_packet_requires"]:
            text = (referral.clinical_indication or "").lower()
            if not any(w in text for w in ["pt", "physical therapy", "nsaid", "conservative"]):
                missing.append("conservative_treatment_attestation")

    return AuthRequirement(
        required=required,
        missing_elements=missing,
        submission_channel=payor["submission_channel"],
        turnaround_days=payor["turnaround_days"],
    )


def build_packet(referral: Referral, eligibility, policy_citations, out_path) -> str:
    """TODO(claude-code): render a PDF with reportlab containing the patient and
    coverage block, requested CPT with description and laterality, ICD-10 codes with
    descriptions, referring provider and NPI, the clinical indication verbatim, and a
    medical necessity narrative citing policy_citations.

    Composition varies by payor per payors.json. If auth_requirement().missing_elements
    is non-empty, do not generate the packet - the referral goes to review with the
    specific reason."""
    raise NotImplementedError
