from pathlib import Path

from app.models import AuthRequirement, Referral
from app.policy import retrieve
from app.validate import ICD10, PAYORS, STUDIES, match_payor

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
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    payor = match_payor(referral.payor_name)
    study = STUDIES.get(referral.cpt_code or "")
    requires = payor["auth_packet_requires"] if payor else []

    styles = getSampleStyleSheet()
    h, body, italic = styles["Heading2"], styles["BodyText"], styles["Italic"]

    def section(title, *lines):
        story.append(Paragraph(title, h))
        for line in lines:
            if line:
                story.append(Paragraph(line, body))
        story.append(Spacer(1, 12))

    story = [
        Paragraph("Prior Authorization Request", styles["Title"]),
        Paragraph("SYNTHETIC TEST DOCUMENT — NO REAL PATIENT INFORMATION", italic),
        Spacer(1, 12),
    ]

    coverage = ""
    if eligibility:
        coverage = f"Coverage: {eligibility.status}"
        if eligibility.plan_name:
            coverage += f"   Plan: {eligibility.plan_name}"
    section("Patient & Coverage",
            f"Patient: {referral.patient_last_name}, {referral.patient_first_name}",
            f"DOB: {referral.patient_dob}   Sex: {referral.patient_sex}",
            f"Payor: {referral.payor_name}   Member ID: {referral.member_id}",
            coverage)

    desc = study["description"] if study else (referral.requested_study or "")
    lat = f"Laterality: {referral.laterality}" if referral.laterality and referral.laterality != "n/a" else ""
    section("Requested Study", f"CPT {referral.cpt_code}: {desc}", lat)

    section("Diagnoses (ICD-10)",
            *[f"{code} — {ICD10.get(code, 'not in catalog')}" for code in referral.icd10_codes])

    section("Referring Provider",
            f"{referral.referring_provider_name}   NPI: {referral.referring_provider_npi}")

    if "clinical_notes" in requires or referral.clinical_indication:
        section("Clinical Indication", referral.clinical_indication or "")

    if "prior_imaging" in requires:
        section("Prior Imaging", "Prior imaging on file; see attached studies.")

    if "conservative_treatment_attestation" in requires:
        section("Conservative Treatment Attestation",
                "The ordering provider attests that the patient has completed a documented trial "
                "of conservative treatment (physical therapy and/or NSAIDs) without adequate relief.")

    story.append(Paragraph("Medical Necessity", h))
    if policy_citations:
        for c in policy_citations:
            clean = "<br/>".join(l.lstrip("# ").strip() for l in c["text"].splitlines() if l.strip())
            story.append(Paragraph(f"Per {Path(c['path']).stem}:", italic))
            story.append(Paragraph(clean, body))
            story.append(Spacer(1, 6))
    else:
        story.append(Paragraph("No specific policy citation retrieved.", body))

    SimpleDocTemplate(str(out_path), pagesize=letter, title="Prior Authorization Request").build(story)
    return str(out_path)


def generate_packet(referral: Referral, eligibility):
    req = auth_requirement(referral)
    if req.required and req.missing_elements:
        reason = (f"{referral.payor_name} requires {', '.join(req.missing_elements)}; "
                  "not present in referral")
        return None, reason

    citations = retrieve(referral.payor_name, referral.cpt_code, referral.icd10_codes)
    OUT.mkdir(exist_ok=True)
    out_path = OUT / f"auth_{referral.member_id or 'unknown'}.pdf"
    build_packet(referral, eligibility, citations, out_path)
    return str(out_path), None
