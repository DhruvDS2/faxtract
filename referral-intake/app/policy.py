import json
from pathlib import Path

POLICY_DIR = Path(__file__).parent.parent / "corpus" / "policies"


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
    """TODO(claude-code): return the k most relevant policy chunks for this
    payor + CPT + ICD combination.

    Start with keyword overlap. With four short documents per payor it may score
    identically to embeddings, and noticing that is worth more than adding a
    vector store because it is expected. Only reach for embeddings if keyword
    retrieval measurably misses."""
    raise NotImplementedError
