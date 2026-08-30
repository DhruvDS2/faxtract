# Your RAG System, Explained — faxtract Prior-Auth Retrieval

## 0. What problem RAG solves here
A referral arrives with a **payor**, a **CPT** code, **ICD-10** codes, and a free-text **clinical
indication**. Somewhere in that payor's policy is the exact clause deciding coverage. Find that
clause so the prior-auth packet can **cite** it. RAG = retrieve the right passage first, then use it.

## 1. WHY RAG (not just ask an LLM / paste the whole KB)
- **Auditability (the big one):** the packet must cite the EXACT clause so a human/payor/auditor can
  trace + verify. Pasting the whole KB gives an answer with no traceable citation.
- Also: **hallucination** risk, **context too big**, **expensive**.

## 2. PHASE 1 — build the library (ONCE, at startup)
**Chunk:** split each of 24 docs on blank lines into sections; glue the title (payor+CPT) onto every
chunk; tag payor/cpt/source → ~216 chunks. A chunk = the unit of retrieval. Too big → decisive
sentence diluted → missed; too small → loses context.
**Embed:** each chunk → 384 numbers (a vector) via local `all-MiniLM-L6-v2`. 384 is the model's fixed
size, NOT chunk length. The numbers = coordinates in "meaning space"; the model was TRAINED so text
in similar contexts gets similar numbers. Vectors normalized to length 1.

## 3. PHASE 2 — search (per referral)
**Parse then embed:** referral is PARSED into fields (indication text, codes, payor). The indication
TEXT is embedded into ONE query vector (same space as chunks). Parsed, NOT chunked.
**Match — two scores per chunk:**
- semantic = DOT PRODUCT of query·chunk (multiply matching positions, add up). Length-1 vectors →
  dot product = cosine = how ALIGNED the arrows are (angle), ~0–1. Direction, not size. All 216 at
  once = one matrix×vector multiply.
- keyword = COUNT of exact CPT/ICD codes literally in the chunk text. Identifiers matched EXACTLY
  (72148 ≠ 72149, though near in meaning-space).
**Merge — fuse to one ranking:**
1. min-max normalize BOTH to 0–1: `(x−min)/(max−min)` (different scales; else keyword dominates).
2. weighted sum: `combined = α·semantic + (1−α)·keyword`. α = trust knob (0.5 equal; ↑ meaning, ↓ codes). Tune by sweeping.
3. payor filter: wrong insurer → −1 (hard, separate from cosine).
4. rank high→low, top-k.

## 4. The 3-STEP hybrid RAG (query expansion)
- **Step 1:** search with the referral's ORIGINAL words → rough shortlist.
- **Step 2:** READ the shortlist, EXTRACT the payor's coverage vocabulary the referral lacked
  ("conservative management", "progressive neurologic deficit"). EXTRACTION, not search. The one
  AI-justified step — but SHIPPED a deterministic word-counter (keyless); LLM version optional.
- **Step 3:** add those words to the query (query expansion), re-run the SAME engine → sharper.
- **Insight:** the first search TEACHES you what to search for; the second USES it. One pass can't.
- Worth it only for LONG docs (buried clause in unfamiliar vocab); over-engineering for short docs.

## 5. Engineering decisions ("don't overuse AI")
- Local embed model (free/offline/deterministic); no LLM for embeddings.
- Originally NO vector DB — 216 chunks → brute-force NumPy cosine is instant; DB = over-engineering.
  NOW adding **pgvector** for learning/portfolio + real GB/millions-of-chunks scale (where an indexed
  DB is a genuine need for speed/memory/persistence).
- Most nodes deterministic; AI reserved for the one judgment step, shipped even that deterministic.

## 6. In the bigger system
The whole 3-step retriever = ONE node ("Prior Auth Retrieval") in the v2 LangGraph pipeline, gated by
a decision node (runs only when prior auth is required). Its chunks → a prior-auth packet PDF that
cites them → shown in the 5-panel review UI (fax → fields → policy docs → packet → RIS order).

## The whole thing in 5 sentences
1. You need the EXACT payor policy clause so the packet can CITE it — pasting the whole KB gives an
   untraceable, possibly hallucinated answer, so you retrieve first.
2. Once at startup you CHUNK 24 docs into ~216 title-tagged sections and EMBED each into a 384-number
   vector (local MiniLM) that places similar meanings near each other.
3. Per referral you embed the indication text into the same space, score every chunk two ways —
   semantic (cosine = dot product of length-1 vectors) and keyword (exact CPT/ICD count) — then
   normalize, weight by α, hard-filter to the payor, and take top-k.
4. You wrap that in a 3-step query expansion — search with the referral's words, extract the payor's
   decisive vocabulary the referral lacked, re-search with those added — because the first search
   teaches you what to search for and the second uses it.
5. You kept it lean — local embeddings, no vector DB at 216 chunks, AI only for the one judgment step
   — and dropped the retriever in as a single gated LangGraph node whose cited chunks build the
   packet shown in the 5-panel UI (now adding pgvector for real scale).
