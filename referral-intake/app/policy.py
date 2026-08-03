import re
from pathlib import Path

from app.validate import ICD10, STUDIES

POLICY_DIR = Path(__file__).parent.parent / "corpus" / "policies"


def _words(text):
    return set(re.findall(r"[a-z]{4,}", text.lower()))


def load_policies():
    """TODO(claude-code): read the markdown policy docs in corpus/policies/,
    one per payor per study family. Write 3-4 short synthetic ones per payor
    covering lumbar MRI, brain MRI, CT chest, mammography."""
    docs = []
    if POLICY_DIR.exists():
        for p in sorted(POLICY_DIR.glob("*.md")):
            docs.append({"path": str(p), "text": p.read_text()})
    return docs


def retrieve(payor_name, cpt_code, icd10_codes, k=2):
    docs = load_policies()

    study = STUDIES.get(cpt_code or "")
    terms = set()
    if study:
        terms |= _words(study["description"])
    for code in icd10_codes:
        terms |= _words(ICD10.get(code, code))

    scored = []
    for d in docs:
        if payor_name and payor_name.lower() not in d["text"].lower():
            continue
        overlap = len(terms & _words(d["text"]))
        if overlap:
            scored.append((overlap, d))

    scored.sort(key=lambda s: s[0], reverse=True)
    return [d for _, d in scored[:k]]
