import math
import os
import re
from collections import Counter
from functools import lru_cache

import numpy as np
from sentence_transformers import SentenceTransformer

from app.policy import load_policies


@lru_cache(maxsize=1)
def _model():
    return SentenceTransformer("all-MiniLM-L6-v2")


def embed(texts):
    return _model().encode(list(texts), normalize_embeddings=True)


def build_index():
    """One-time prep: chunk the KB and embed every chunk."""
    chunks = chunk_policies()
    vectors = embed([c["text"] for c in chunks])
    return chunks, vectors


def chunk_policies():
    """Split every policy doc into retrieval chunks."""
    chunks = []
    for doc in load_policies():
        chunks.extend(_chunk_one(doc["path"], doc["text"]))
    return chunks


def _chunk_one(path, text):
    paras = [p.strip() for p in text.strip().split("\n\n") if p.strip()]
    title = paras[0].lstrip("#").strip()

    payor = title.split(" — ")[0].strip()
    m = re.search(r"CPT\s+(\w+)", title)
    cpt = m.group(1) if m else None

    chunks = []
    for para in paras[1:]:
        chunks.append({
            "text": f"{title}\n{para}",
            "payor": payor,
            "cpt": cpt,
            "source": path,
        })
    return chunks


def semantic_scores(query_text, vectors):
    qv = embed([query_text])[0]
    return vectors @ qv


def keyword_scores(codes, chunks):
    codes = [c.lower() for c in codes if c]
    scores = []
    for ch in chunks:
        text = ch["text"].lower()
        scores.append(float(sum(1 for code in codes if code in text)))
    return np.array(scores)


def _norm(x):
    x = np.asarray(x, dtype=float)
    lo, hi = x.min(), x.max()
    if hi - lo < 1e-9:
        return np.zeros_like(x)
    return (x - lo) / (hi - lo)


@lru_cache(maxsize=1)
def _index():
    return build_index()


def retrieve(indication, codes, payor, k=2, alpha=0.5):
    chunks, vectors = _index()

    combined = alpha * _norm(semantic_scores(indication, vectors)) \
        + (1 - alpha) * _norm(keyword_scores(codes, chunks))

    for i, ch in enumerate(chunks):
        if payor and payor.lower() not in ch["payor"].lower():
            combined[i] = -1.0

    order = np.argsort(combined)[::-1][:k]
    return [(chunks[i], float(combined[i])) for i in order]


_STOP = {
    "medically", "necessary", "referral", "documents", "following", "prior", "authorization",
    "required", "clinical", "notes", "imaging", "study", "studies", "plan", "health", "submit",
    "standard", "business", "days", "policy", "medical", "review", "considers", "coverage",
    "criteria", "documentation", "requirements", "must", "include", "patient", "patients",
    "evaluation", "this", "that", "with", "when", "meridian", "cascade", "northgate", "mutual",
    "synthetic", "content", "background", "definitions", "exceptions", "expedited", "reference",
    "appropriateness", "internal", "cycle", "annual", "considered", "circumstances", "does",
    "requested", "specify", "submitted", "additional", "records", "requested", "during",
}


def extract_keywords(shortlist, query, n=6):
    """STEP 2: harvest the payor-vocabulary terms that govern coverage,
    from the step-1 chunks, that were NOT already in the referral."""
    qwords = set(re.findall(r"[a-z]{4,}", query.lower()))
    all_chunks, _ = _index()

    df = Counter()
    for ch in all_chunks:
        for w in set(re.findall(r"[a-z]{4,}", ch["text"].lower())):
            df[w] += 1
    n_docs = len(all_chunks)

    tf = Counter()
    for ch in shortlist:
        for w in re.findall(r"[a-z]{4,}", ch["text"].lower()):
            tf[w] += 1

    scored = {}
    for w, count in tf.items():
        if w in qwords or w in _STOP:
            continue
        scored[w] = count * math.log(n_docs / (1 + df[w]))
    return [w for w, _ in sorted(scored.items(), key=lambda kv: kv[1], reverse=True)[:n]]


def extract_keywords_llm(shortlist, query, n=6, model="claude-haiku-4-5-20251001"):
    """STEP 2, the LLM version: judgment about which terms GOVERN coverage."""
    import anthropic

    text = "\n\n".join(c["text"] for c in shortlist)
    prompt = (
        f"Below is payor medical-policy text. List the {n} specific terms or short phrases that "
        f"DETERMINE whether the study is covered (the coverage-criteria vocabulary), that are NOT "
        f'already present in this referral: "{query}". '
        f"Return only a comma-separated list, nothing else.\n\n{text}"
    )
    msg = anthropic.Anthropic().messages.create(
        model=model, max_tokens=120,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text
    return [t.strip() for t in raw.split(",") if t.strip()][:n]


def retrieve_3step(indication, codes, payor, k=2, extractor=extract_keywords):
    """The 3-step hybrid RAG: search -> learn vocabulary -> search again."""
    shortlist = retrieve(indication, codes, payor, k=4)                # STEP 1
    keywords = extractor([c for c, _ in shortlist], indication)        # STEP 2
    expanded = indication + " " + " ".join(keywords)
    results = retrieve(expanded, codes, payor, k=k)                    # STEP 3
    return {"shortlist": shortlist, "keywords": keywords,
            "expanded_query": expanded, "results": results}


def _section(chunk):
    for line in chunk["text"].splitlines():
        if line.startswith("## "):
            return line[3:]
    return "(title)"


def _load_dotenv():
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def _show(label, out):
    print(f"\n=== STEP 2 via {label} ===")
    print(f"keywords: {out['keywords']}")
    print("STEP 3 re-ranked:")
    for ch, s in out["results"]:
        print(f"   [{s:.3f}] {_section(ch)}")


if __name__ == "__main__":
    _load_dotenv()

    indication = "chronic low back pain, physical therapy has not helped, leg weakness getting worse"
    codes = ["72148", "M54.16"]
    payor = "Meridian Health"

    det = retrieve_3step(indication, codes, payor, k=3, extractor=extract_keywords)

    print(f'referral: {payor} | {codes}')
    print(f'indication: "{indication}"\n')
    print("STEP 1  rough shortlist (original words only):")
    for ch, s in det["shortlist"]:
        print(f"   [{s:.3f}] {_section(ch)}")

    _show("deterministic word-counter", det)

    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            llm = retrieve_3step(indication, codes, payor, k=3, extractor=extract_keywords_llm)
            _show("LLM (judgment)", llm)
        except Exception as e:
            print(f"\n(LLM step 2 skipped: {type(e).__name__}: {e})")
    else:
        print("\n(no ANTHROPIC_API_KEY — LLM step 2 skipped)")
