import json
import random
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def npi_check_digit(base9):
    digits = [int(c) for c in "80840" + base9]
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10


def make_npi(rng):
    base = "".join(str(rng.randint(0, 9)) for _ in range(9))
    return base + str(npi_check_digit(base))


FIRST = ["Marcus", "Danielle", "Priya", "Tomas", "Renee", "Abdul", "Grace", "Nikolai",
         "Yolanda", "Hector", "Simone", "Devon", "Ingrid", "Rashid", "Clara", "Owen",
         "Marisol", "Terrence", "Anya", "Felix", "Nadia", "Ellis", "Junko", "Rowan"]
LAST = ["Whitfield", "Okonkwo", "Barrera", "Lindqvist", "Nakamura", "Delacroix",
        "Ashford", "Petrov", "Ramirez", "Coleridge", "Ibrahim", "Vance", "Sorensen",
        "Mbeki", "Halloran", "Duarte", "Kestrel", "Ferreira", "Novak", "Brannigan"]
PROVIDER_LAST = ["Halvorsen", "Adeyemi", "Castellanos", "Rourke", "Nagata", "Pemberton",
                 "Villanueva", "Strand", "Oyelaran", "Beaumont", "Kaur", "Lindstrom"]
CITIES = [("Rochester", "NY", "14604"), ("Yonkers", "NY", "10701"), ("Paterson", "NJ", "07501"),
          ("Stamford", "CT", "06901"), ("Allentown", "PA", "18101"), ("Danbury", "CT", "06810")]
STREETS = ["Larkspur Ave", "Bramble Ct", "Fenwick St", "Old Mill Rd", "Corbin Way",
           "Selby Ln", "Harlow Dr", "Pinegrove Ter"]


def build(rng):
    patients = []
    for i in range(80):
        city, state, zipc = rng.choice(CITIES)
        sex = rng.choice(["M", "F"])
        patients.append({
            "id": f"P{i:04d}",
            "first_name": rng.choice(FIRST),
            "last_name": rng.choice(LAST),
            "dob": f"{rng.randint(1945, 2012)}-{rng.randint(1,12):02d}-{rng.randint(1,28):02d}",
            "sex": sex,
            "phone": f"({rng.randint(200,989)}) {rng.randint(200,989)}-{rng.randint(1000,9999)}",
            "address": f"{rng.randint(10, 8999)} {rng.choice(STREETS)}",
            "city": city,
            "state": state,
            "zip": zipc,
        })

    practices = ["Riverbend Family Medicine", "Copperfield Internal Medicine",
                 "Northline Orthopedics", "Sutter Creek Primary Care",
                 "Ellsworth Neurology Associates", "Kestrel Women's Health"]
    providers = []
    for i in range(18):
        providers.append({
            "id": f"DR{i:03d}",
            "first_name": rng.choice(FIRST),
            "last_name": rng.choice(PROVIDER_LAST),
            "npi": make_npi(rng),
            "practice": rng.choice(practices),
            "phone": f"({rng.randint(200,989)}) {rng.randint(200,989)}-{rng.randint(1000,9999)}",
            "fax": f"({rng.randint(200,989)}) {rng.randint(200,989)}-{rng.randint(1000,9999)}",
        })

    payors = [
        {
            "name": "Meridian Health",
            "payor_id": "MRDN01",
            "member_id_regex": "^MH[0-9]{9}$",
            "member_id_format": "MH + 9 digits",
            "auth_required_modalities": ["MR", "CT", "PT"],
            "auth_packet_requires": ["clinical_notes", "prior_imaging"],
            "submission_channel": "portal",
            "turnaround_days": 3,
        },
        {
            "name": "Cascade Mutual",
            "payor_id": "CASC02",
            "member_id_regex": "^[0-9]{11}$",
            "member_id_format": "11 digits",
            "auth_required_modalities": ["MR", "PT"],
            "auth_packet_requires": ["clinical_notes"],
            "submission_channel": "fax",
            "turnaround_days": 5,
        },
        {
            "name": "Northgate Plan",
            "payor_id": "NRTH03",
            "member_id_regex": "^NG-[A-Z0-9]{8}$",
            "member_id_format": "NG- + 8 alphanumeric",
            "auth_required_modalities": ["MR", "CT", "PT", "NM"],
            "auth_packet_requires": ["clinical_notes", "prior_imaging", "conservative_treatment_attestation"],
            "submission_channel": "fax",
            "turnaround_days": 2,
        },
    ]

    studies = [
        {"cpt": "72148", "description": "MRI lumbar spine without contrast", "modality": "MR",
         "laterality_required": False, "service_type_code": "62",
         "supporting_icd10": ["M54.16", "M51.36", "M54.5", "G95.9"]},
        {"cpt": "70553", "description": "MRI brain with and without contrast", "modality": "MR",
         "laterality_required": False, "service_type_code": "62",
         "supporting_icd10": ["R51.9", "G43.909", "R42", "D33.2"]},
        {"cpt": "73721", "description": "MRI lower extremity joint without contrast", "modality": "MR",
         "laterality_required": True, "service_type_code": "62",
         "supporting_icd10": ["M25.561", "M23.51", "S83.241A", "M17.11"]},
        {"cpt": "71260", "description": "CT chest with contrast", "modality": "CT",
         "laterality_required": False, "service_type_code": "4",
         "supporting_icd10": ["R91.1", "R05.3", "J98.4", "R59.1"]},
        {"cpt": "74177", "description": "CT abdomen and pelvis with contrast", "modality": "CT",
         "laterality_required": False, "service_type_code": "4",
         "supporting_icd10": ["R10.9", "R10.31", "K57.30", "R19.00"]},
        {"cpt": "73200", "description": "CT upper extremity without contrast", "modality": "CT",
         "laterality_required": True, "service_type_code": "4",
         "supporting_icd10": ["S52.501A", "M25.521", "M79.641"]},
        {"cpt": "77066", "description": "Diagnostic mammography bilateral", "modality": "MG",
         "laterality_required": False, "service_type_code": "4",
         "supporting_icd10": ["N63.0", "N64.59", "R92.8"]},
        {"cpt": "76700", "description": "Ultrasound abdomen complete", "modality": "US",
         "laterality_required": False, "service_type_code": "4",
         "supporting_icd10": ["R10.11", "K80.20", "R16.0"]},
    ]

    icd10 = {
        "M54.16": "Radiculopathy, lumbar region",
        "M51.36": "Other intervertebral disc degeneration, lumbar region",
        "M54.5": "Low back pain",
        "G95.9": "Disease of spinal cord, unspecified",
        "R51.9": "Headache, unspecified",
        "G43.909": "Migraine, unspecified, not intractable",
        "R42": "Dizziness and giddiness",
        "D33.2": "Benign neoplasm of brain, unspecified",
        "M25.561": "Pain in right knee",
        "M23.51": "Chronic instability of knee, right knee",
        "S83.241A": "Other tear of medial meniscus, current injury, right knee, initial encounter",
        "M17.11": "Unilateral primary osteoarthritis, right knee",
        "R91.1": "Solitary pulmonary nodule",
        "R05.3": "Chronic cough",
        "J98.4": "Other disorders of lung",
        "R59.1": "Generalized enlarged lymph nodes",
        "R10.9": "Unspecified abdominal pain",
        "R10.31": "Right lower quadrant pain",
        "K57.30": "Diverticulosis of large intestine without perforation or abscess",
        "R19.00": "Intra-abdominal and pelvic swelling, mass and lump, unspecified site",
        "S52.501A": "Unspecified fracture of the lower end of right radius, initial encounter",
        "M25.521": "Pain in right elbow",
        "M79.641": "Pain in right hand",
        "N63.0": "Unspecified lump in unspecified breast",
        "N64.59": "Other signs and symptoms in breast",
        "R92.8": "Other abnormal and inconclusive findings on diagnostic imaging of breast",
        "R10.11": "Right upper quadrant pain",
        "K80.20": "Calculus of gallbladder without cholecystitis without obstruction",
        "R16.0": "Hepatomegaly, not elsewhere classified",
    }

    clinic = {
        "name": "Hollis Park Imaging",
        "npi": make_npi(rng),
        "address": "1400 Ashgrove Blvd, Suite 200",
        "city": "White Plains",
        "state": "NY",
        "zip": "10601",
        "phone": "(914) 555-0142",
        "fax": "(914) 555-0143",
    }

    return {
        "patients.json": patients,
        "providers.json": providers,
        "payors.json": payors,
        "studies.json": {"studies": studies, "icd10": icd10, "clinic": clinic},
    }


if __name__ == "__main__":
    rng = random.Random(1701)
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for name, data in build(rng).items():
        (FIXTURES / name).write_text(json.dumps(data, indent=2))
        print("wrote", name)
