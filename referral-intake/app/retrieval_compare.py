"""v1 keyword retrieval vs v2 3-step hybrid RAG for one referral, side by side
(GET /referrals/{id}/retrieval-compare; docs/CONTRACTS.md §5 and §15).

Both get the same query: the referral's clinical indication (or study text),
its codes (CPT + ICD-10) and its payor.

    v1  app.policy.retrieve(payor, cpt, icd10, k)   whole policy documents ranked by
        how many study/diagnosis words they share; the score shown is that overlap count
    v2  app.rag.retrieve_3step(indication, codes, payor, k)   pgvector semantic search +
        exact-code match, harvest payor vocabulary, search again; the score is the
        blended 0-1 score

expected_source is the policy doc that should win: same payor (app.validate.match_payor)
and chunk metadata cpt containing the referral's CPT, from app.rag.chunk_policies().
"""
from __future__ import annotations

import time
from pathlib import Path

from app.contracts import RetrievalCompare, RetrievedChunk, RetrieverRun, ReferralRecord
from app.validate import ICD10, STUDIES, match_payor


class CompareUnavailable(ValueError):
    """Nothing to compare for this referral (409); the message says why."""


def query_for(record: ReferralRecord) -> dict:
    r = record.referral
    return {
        "indication": r.clinical_indication or r.requested_study or "",
        "codes": [c for c in [r.cpt_code, *r.icd10_codes] if c],
        "payor": r.payor_name,
    }


def check_comparable(record: ReferralRecord) -> None:
    r = record.referral
    if not r.payor_name:
        raise CompareUnavailable("this referral has no payor, and both retrievers filter policies by payor")
    auth = record.auth
    if auth is None:  # the pipeline never evaluated auth for this record: work it out now
        from app.auth_packet import auth_requirement
        auth = auth_requirement(r)
    if not auth.required:
        study = f"CPT {r.cpt_code}" if r.cpt_code else "this study"
        raise CompareUnavailable(f"{r.payor_name} requires no prior authorization for {study}, "
                                 f"so there is no policy to retrieve")


def _doc_meta(path: str, text: str) -> tuple[str | None, str | None]:
    from app.rag import _chunk_one  # the same title parsing the index uses
    chunks = _chunk_one(path, text)
    return (chunks[0]["payor"], chunks[0]["cpt"]) if chunks else (None, None)


def _v1_terms(cpt_code: str | None, icd10_codes: list[str]) -> set[str]:
    # the query terms app.policy.retrieve builds, so the overlap score below is its own
    from app.policy import _words
    terms: set[str] = set()
    study = STUDIES.get(cpt_code or "")
    if study:
        terms |= _words(study["description"])
    for code in icd10_codes:
        terms |= _words(ICD10.get(code, code))
    return terms


def run_v1(record: ReferralRecord, k: int) -> RetrieverRun:
    from app.policy import _words, retrieve
    r = record.referral
    t0 = time.perf_counter()
    docs = retrieve(r.payor_name, r.cpt_code, r.icd10_codes, k=k)
    latency = (time.perf_counter() - t0) * 1000
    terms = _v1_terms(r.cpt_code, r.icd10_codes)
    chunks = []
    for rank, doc in enumerate(docs, start=1):
        payor, cpt = _doc_meta(doc["path"], doc["text"])
        chunks.append(RetrievedChunk(rank=rank, source=Path(doc["path"]).stem, payor=payor, cpt=cpt,
                                     score=float(len(terms & _words(doc["text"]))), text=doc["text"]))
    return RetrieverRun(name="v1 keyword", impl="app.policy.retrieve", latency_ms=round(latency, 3),
                        keywords=sorted(terms), chunks=chunks)


def run_v2(record: ReferralRecord, k: int) -> RetrieverRun:
    from app import rag
    q = query_for(record)
    # one-time costs (embedding model load, step-2 vocabulary index) are not retrieval latency
    rag._model()
    rag._index()
    t0 = time.perf_counter()
    out = rag.retrieve_3step(q["indication"], q["codes"], q["payor"], k=k)
    latency = (time.perf_counter() - t0) * 1000
    chunks = [RetrievedChunk(rank=i, source=Path(ch["source"]).stem, payor=ch.get("payor"), cpt=ch.get("cpt"),
                             score=round(float(score), 4), text=ch["text"])
              for i, (ch, score) in enumerate(out["results"], start=1)]
    return RetrieverRun(name="v2 3-step hybrid RAG", impl="app.rag.retrieve_3step",
                        latency_ms=round(latency, 3), keywords=list(out["keywords"]), chunks=chunks)


def expected_source(payor_name: str | None, cpt_code: str | None) -> str | None:
    payor = match_payor(payor_name)
    if not payor or not cpt_code:
        return None
    from app.rag import chunk_policies
    for ch in chunk_policies():
        ch_payor = match_payor(ch.get("payor"))
        if ch_payor and ch_payor["name"] == payor["name"] and cpt_code in (ch.get("cpt") or ""):
            return Path(ch["source"]).stem
    return None


def compare(record: ReferralRecord, k: int = 5) -> RetrievalCompare:
    check_comparable(record)
    k = max(1, min(int(k), 20))
    v1 = run_v1(record, k)
    v2 = run_v2(record, k)
    return RetrievalCompare(referral_id=record.id, query=query_for(record),
                            expected_source=expected_source(record.referral.payor_name,
                                                            record.referral.cpt_code),
                            v1=v1, v2=v2)
