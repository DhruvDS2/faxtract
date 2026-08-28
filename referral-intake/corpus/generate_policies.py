"""Generate long, multi-section synthetic payor medical-policy docs.

Rewrites corpus/policies/<payor>__<family>.md as full policies (background,
definitions, coverage criteria, documentation, exclusions, exceptions,
submission) so the decisive clause is BURIED and written in payor vocabulary —
which is what makes the 3-step (query-expansion) RAG worth doing.
All data synthetic.
"""

from pathlib import Path

POLICY_DIR = Path(__file__).parent / "policies"

FAMILIES = {
    "lumbar-mri": {
        "study": "MRI Lumbar Spine", "cpt": "72148", "modality": "MR", "laterality": False,
        "background": (
            "MRI of the lumbar spine evaluates the intervertebral discs, spinal canal, and nerve "
            "roots. Because most acute low back pain resolves with first-line care, advanced imaging "
            "is reserved for patients whose symptoms persist despite an adequate treatment trial or "
            "who present with findings suggesting serious underlying pathology."
        ),
        "definitions": [
            ("conservative management", "a documented trial of non-surgical care including physical therapy, NSAIDs, and activity modification"),
            ("red-flag features", "clinical findings suggesting malignancy, spinal infection, fracture, or cauda equina syndrome"),
            ("radiculopathy", "radiating pain, numbness, or weakness following a nerve-root distribution"),
        ],
        "criteria": [
            "Low back pain or lumbar radiculopathy persisting at least 6 weeks despite documented conservative management",
            "Progressive neurologic deficit or objective motor weakness on examination",
            "Clinical suspicion of malignancy, spinal infection, or cauda equina syndrome",
            "Preoperative planning in a documented surgical candidate",
        ],
        "exclusions": [
            "Acute uncomplicated low back pain of less than 6 weeks without red-flag features",
            "Repeat imaging within 12 months absent a clinically significant change in status",
            "Imaging in asymptomatic patients for screening purposes",
        ],
        "exceptions": (
            "When progressive neurologic deficit, suspected cauda equina syndrome, or clinical "
            "suspicion of malignancy or infection is documented, the conservative-management waiting "
            "period is waived and the request is routed to expedited review."
        ),
    },
    "brain-mri": {
        "study": "MRI Brain", "cpt": "70553", "modality": "MR", "laterality": False,
        "background": (
            "MRI of the brain evaluates intracranial structures for mass, hemorrhage, demyelination, "
            "and vascular abnormality. It is indicated when the clinical picture cannot be explained "
            "by a benign primary headache disorder or a self-limited process."
        ),
        "definitions": [
            ("red-flag headache", "a new, worsening, thunderclap, or positional headache, or headache accompanied by neurologic signs"),
            ("focal neurologic deficit", "a localizable finding such as weakness, sensory loss, aphasia, or visual-field loss"),
        ],
        "criteria": [
            "New, worsening, or thunderclap headache with red-flag features",
            "Focal neurologic deficit, new-onset seizure, or suspected intracranial mass",
            "Unexplained dizziness or vertigo persisting after an initial evaluation",
            "Follow-up of a previously identified intracranial lesion",
        ],
        "exclusions": [
            "Uncomplicated primary headache (typical migraine or tension-type) responding to therapy",
            "Imaging in asymptomatic patients for screening purposes",
        ],
        "exceptions": (
            "Sudden thunderclap headache, an acute focal neurologic deficit, or a first seizure "
            "warrants expedited review without a prior treatment trial."
        ),
    },
    "ct-chest": {
        "study": "CT Chest", "cpt": "71260", "modality": "CT", "laterality": False,
        "background": (
            "CT of the chest with contrast evaluates the lung parenchyma, mediastinum, and thoracic "
            "vasculature. It is used to characterize findings seen on prior imaging or to investigate "
            "symptoms suspicious for malignancy or thoracic disease."
        ),
        "definitions": [
            ("pulmonary nodule", "a discrete rounded opacity up to 3 cm identified on prior imaging"),
            ("structured follow-up", "interval imaging performed on a recognized nodule-surveillance schedule"),
        ],
        "criteria": [
            "Structured follow-up of a pulmonary nodule identified on prior imaging",
            "Chronic cough or hemoptysis with clinical suspicion of malignancy",
            "Evaluation of a known or suspected thoracic mass, lymphadenopathy, or interstitial disease",
            "Staging of a known malignancy",
        ],
        "exclusions": [
            "Routine screening outside an approved lung-cancer screening program",
            "Acute uncomplicated upper-respiratory infection",
        ],
        "exceptions": (
            "Massive hemoptysis, or suspected pulmonary embolism with hemodynamic compromise, "
            "warrants expedited review."
        ),
    },
    "mammography": {
        "study": "Diagnostic Mammography", "cpt": "77066", "modality": "MG", "laterality": False,
        "background": (
            "Diagnostic mammography evaluates a specific breast concern and is distinct from routine "
            "screening mammography. It is directed by a focal symptom or an abnormal prior study."
        ),
        "definitions": [
            ("focal breast symptom", "a palpable lump, focal pain, nipple discharge, or localized skin change"),
            ("short-interval follow-up", "repeat imaging of a probably-benign finding at a defined interval"),
        ],
        "criteria": [
            "A palpable breast lump or other focal breast symptom",
            "Further evaluation of an abnormal or inconclusive screening finding",
            "Short-interval follow-up of a probably-benign prior finding",
            "Evaluation in a patient with a personal history of breast cancer",
        ],
        "exclusions": [
            "Routine annual screening in an asymptomatic average-risk patient (billed under screening codes)",
        ],
        "exceptions": (
            "A clinically suspicious mass with associated skin changes warrants expedited diagnostic "
            "evaluation."
        ),
    },
    "lower-extremity-mri": {
        "study": "MRI Lower Extremity Joint", "cpt": "73721", "modality": "MR", "laterality": True,
        "background": (
            "MRI of a lower-extremity joint, most commonly the knee, evaluates internal derangement of "
            "the cartilage, menisci, ligaments, and subchondral bone when radiographs and clinical "
            "examination are insufficient."
        ),
        "definitions": [
            ("internal derangement", "a structural injury such as a meniscal or ligament tear"),
            ("mechanical symptoms", "locking, catching, or the joint giving way"),
            ("conservative management", "a documented trial of physical therapy, NSAIDs, and activity modification"),
        ],
        "criteria": [
            "Persistent joint pain or mechanical symptoms lasting at least 6 weeks despite conservative management",
            "Suspected internal derangement (meniscal or ligament tear) following acute injury",
            "Suspected osteoarthritis, avascular necrosis, or occult fracture not explained by radiographs",
        ],
        "exclusions": [
            "Acute uncomplicated joint sprain without mechanical symptoms",
            "Repeat imaging absent a change in clinical status",
        ],
        "exceptions": (
            "A locked knee, or suspected complete ligament rupture with instability, warrants expedited "
            "review without the conservative-management waiting period."
        ),
    },
    "ct-abdomen-pelvis": {
        "study": "CT Abdomen and Pelvis", "cpt": "74177", "modality": "CT", "laterality": False,
        "background": (
            "CT of the abdomen and pelvis with contrast evaluates the solid organs, bowel, and "
            "retroperitoneum. It is indicated for acute pathology or to characterize findings that "
            "prior imaging left indeterminate."
        ),
        "definitions": [
            ("acute abdomen", "severe abdominal pain with peritoneal signs suggesting a surgical emergency"),
            ("indeterminate lesion", "a finding on prior imaging that requires further characterization"),
        ],
        "criteria": [
            "Acute abdominal or pelvic pain with suspicion of appendicitis, diverticulitis, or bowel obstruction",
            "Characterization of a known or indeterminate mass or lymphadenopathy",
            "Follow-up of a previously identified lesion",
            "Unexplained weight loss accompanied by abnormal laboratory findings",
        ],
        "exclusions": [
            "Chronic stable pain without new or progressive findings",
            "Imaging in asymptomatic patients for screening purposes",
        ],
        "exceptions": (
            "Suspected bowel perforation, mesenteric ischemia, or a ruptured aortic aneurysm warrants "
            "expedited review."
        ),
    },
    "ct-upper-extremity": {
        "study": "CT Upper Extremity", "cpt": "73200", "modality": "CT", "laterality": True,
        "background": (
            "CT of an upper extremity evaluates complex osseous anatomy where radiographs are "
            "insufficient. It is directed at bony detail rather than soft-tissue structures."
        ),
        "definitions": [
            ("intra-articular fracture", "a fracture extending into the joint surface"),
            ("osseous detail", "fine bony architecture not resolved on plain radiographs"),
        ],
        "criteria": [
            "A complex or intra-articular fracture not adequately characterized on radiographs",
            "Suspected bone tumor, osteomyelitis, or aggressive osseous lesion",
            "Postoperative evaluation of hardware, nonunion, or malunion",
        ],
        "exclusions": [
            "A simple non-displaced fracture adequately seen on radiographs",
            "Soft-tissue evaluation better suited to MRI or ultrasound",
        ],
        "exceptions": (
            "An open fracture, or suspected compartment syndrome, warrants expedited review."
        ),
    },
    "ultrasound-abdomen": {
        "study": "Ultrasound Abdomen Complete", "cpt": "76700", "modality": "US", "laterality": False,
        "background": (
            "Complete abdominal ultrasound evaluates the liver, gallbladder, biliary tree, kidneys, "
            "pancreas, and spleen without ionizing radiation. It is the preferred first-line study for "
            "suspected hepatobiliary disease."
        ),
        "definitions": [
            ("RUQ pain", "right upper quadrant pain suggestive of biliary disease"),
            ("hepatobiliary", "relating to the liver and biliary system"),
        ],
        "criteria": [
            "Right upper quadrant pain with suspected gallstones or cholecystitis",
            "Abnormal liver function tests or suspected hepatobiliary disease",
            "Evaluation of hepatomegaly, ascites, or a known or suspected abdominal mass",
            "Surveillance of a known abdominal aortic aneurysm",
        ],
        "exclusions": [
            "Routine screening in asymptomatic average-risk patients (except approved aneurysm screening)",
        ],
        "exceptions": (
            "Suspected acute cholecystitis with systemic signs warrants expedited evaluation."
        ),
    },
}

PAYORS = {
    "meridian-health": {
        "name": "Meridian Health", "code": "MRDN", "gated": {"MR", "CT", "PT"},
        "channel": "the Meridian provider portal", "turnaround": 3,
        "docs": "clinical notes and prior imaging",
        "documentation": (
            "The referral must include clinical notes documenting the presenting complaint, the "
            "duration of symptoms, and any prior conservative management. Prior imaging of the same "
            "region, if available, must be submitted for comparison."
        ),
    },
    "cascade-mutual": {
        "name": "Cascade Mutual", "code": "CASC", "gated": {"MR", "PT"},
        "channel": "fax", "turnaround": 5,
        "docs": "clinical notes",
        "documentation": (
            "The referral must include clinical notes describing the presenting complaint and the "
            "clinical rationale for the requested study. Additional records may be requested during "
            "review."
        ),
    },
    "northgate-plan": {
        "name": "Northgate Plan", "code": "NRTH", "gated": {"MR", "CT", "PT", "NM"},
        "channel": "fax", "turnaround": 2,
        "docs": "clinical notes, prior imaging, and a signed conservative-treatment attestation",
        "documentation": (
            "The referral must include clinical notes, prior imaging of the same region, and a signed "
            "conservative-treatment attestation confirming that guideline-concordant non-surgical care "
            "was trialed and documented. Incomplete submissions are returned without a coverage "
            "determination."
        ),
    },
}


def _auth_line(payor, modality):
    if modality in payor["gated"]:
        return f"Prior authorization is REQUIRED for this study. Required documentation: {payor['docs']}."
    return (
        f"Prior authorization is NOT required for {modality} studies under this plan. "
        "Clinical notes should accompany the order."
    )


def build_doc(payor, fam):
    p, f = PAYORS[payor], FAMILIES[fam]
    lines = []
    lines.append(f"# {p['name']} — Medical Policy: {f['study']} (CPT {f['cpt']})")
    lines.append("")
    lines.append(f"Policy No. {p['code']}-{f['cpt']} · Review cycle: annual · All content synthetic.")
    lines.append("")
    lines.append("## Background")
    lines.append(f['background'])
    lines.append("")
    lines.append("## Definitions")
    for term, meaning in f["definitions"]:
        lines.append(f"- **{term}**: {meaning}")
    lines.append("")
    lines.append("## Coverage Criteria")
    lines.append(f"{p['name']} considers {f['study'].lower()} medically necessary when the referral documents any of the following:")
    for c in f["criteria"]:
        lines.append(f"- {c}")
    if f["laterality"]:
        lines.append("The requested study must specify laterality (right or left).")
    lines.append("")
    lines.append("## Documentation Requirements")
    lines.append(p['documentation'])
    lines.append("")
    lines.append("## Non-Covered and Exclusions")
    lines.append(f"{p['name']} does not consider the study medically necessary in the following circumstances:")
    for e in f["exclusions"]:
        lines.append(f"- {e}")
    lines.append("")
    lines.append("## Exceptions and Expedited Review")
    lines.append(f["exceptions"])
    lines.append("")
    lines.append("## Prior Authorization and Submission")
    lines.append(_auth_line(p, f["modality"]))
    lines.append(f"Submit via {p['channel']}. Standard turnaround is {p['turnaround']} business days.")
    lines.append("")
    lines.append("## References")
    lines.append(f"Internal medical policy {p['code']}-{f['cpt']}; {f['modality']} appropriateness criteria (synthetic reference).")
    lines.append("")
    return "\n".join(lines)


def main():
    POLICY_DIR.mkdir(exist_ok=True)
    n = 0
    for payor in PAYORS:
        for fam in FAMILIES:
            (POLICY_DIR / f"{payor}__{fam}.md").write_text(build_doc(payor, fam))
            n += 1
    print(f"wrote {n} policy docs to {POLICY_DIR}")


if __name__ == "__main__":
    main()
