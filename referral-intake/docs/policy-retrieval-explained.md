# How Policy Retrieval Works in faxtract — and How to Debug It

## Part 1 — How it works (happy path)

**The job:** given a referral (payor, CPT, ICD-10 codes, free-text indication), find the payor policy
passage that decides coverage, so the prior-auth packet can cite it.

**Knowledge base (built once):** 24 payor policy docs → split into sections → ~216 chunks → each
embedded to a 384-dim vector (local `all-MiniLM-L6-v2`, normalized) → stored in Postgres via
**pgvector** in table `policy_chunks` (source, payor, cpt, text, embedding).

**Retrieval = 3-step hybrid (`retrieve_3step` in `app/rag.py`):**
- **Step 1 (`retrieve_pg`):** embed the indication → `semantic_candidates()` in `app/vectorstore.py`
  runs SQL nearest-neighbor: `WHERE payor ILIKE :payor ORDER BY embedding <=> :query LIMIT ~50`
  (`<=>` = cosine distance; payor filter is the most important line). Then in Python: keyword score
  (count of exact CPT/ICD codes in each chunk), min-max normalize both scores to 0–1, weighted-sum
  (alpha=0.5), take top-k.
- **Step 2:** read the top chunks, extract the payor's governing keywords the referral lacked
  (deterministic word-counter ships; LLM version exists).
- **Step 3:** add those keywords to the query, re-run the same retrieval (query expansion) → final citations.

**API:** `GET /referrals/{id}/policy` → `{keywords, citations}`; `/packet` → PDF citing them. Both
gated on `auth.required` — no auth needed → retrieval skipped → empty is CORRECT.

## Part 2 — Debugging playbook (do in order)

1. **Postgres up + table populated?**
   `psql faxtract -c "SELECT payor, count(*) FROM policy_chunks GROUP BY payor;"`
   - connection refused → Postgres not running. Zero rows → `python -m scripts.index_chunks`.
   - payor missing from list → that payor has no docs (data gap, not a bug).
2. **Hit the endpoint, read JSON:** `curl -s localhost:8000/referrals/<ID>/policy | jq`
   - `required` false → empty citations expected. `keywords` empty → top chunks were off.
     `citations` → right payor + section?
3. **500 / spins forever → read the uvicorn traceback.** The classic:
   `sqlalchemy.exc.TimeoutError: QueuePool limit ... reached` = leaked DB session (a session opened
   and never closed). Fix: wrap in `with SessionLocal() as db:` so it always returns to the pool.
   Recognize it by the words `QueuePool ... reached`.
4. **Check the referral has a `payor_name` and `auth.required=true`.** Retrieval hangs off the payor
   filter — if extraction dropped the payor, retrieval has nothing to filter on. Wrong-payor citations
   almost always trace to a bad/missing extracted payor name.
5. **Citations wrong?** Wrong doc/payor → back to #4 (payor filter). Right doc but wrong SECTION
   (Exclusions above Coverage Criteria) → known ranking limit: semantic overlap fools the ranker and
   the deterministic step-2 keywords are too coarse; the LLM step-2 fixes it. Not a crash.

## Recap
3-step hybrid RAG: embed indication → pull ~50 payor-filtered candidates from pgvector by cosine →
re-rank by 50/50 semantic + exact-code-keyword blend → find missing governing keywords → re-query.
Hinges on the payor filter (needs a good extracted `payor_name`) and a healthy indexed `policy_chunks`
table. Debug in order: DB up+full → curl /policy → read traceback (QueuePool=leaked session, fix with
`with`) → check payor_name + auth.required → inspect returned chunks. Empty is often correct (gated);
"right doc wrong section" is a known limit, not a bug.
Files: `app/rag.py`, `app/vectorstore.py`, `scripts/index_chunks.py`, `/policy` + `/packet` endpoints.
