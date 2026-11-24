# faxtract status check (P0)

- **Run:** 2026-11-23, against `main @ aecf845`, read-only. The run prompt is in [`docs/STATUS-RUN.md`](../STATUS-RUN.md).
- **Method:** three parallel lanes, all Opus at xhigh:
  - A: scope and git, from the code.
  - B: install and run everything in a fresh clone in scratch space.
  - C: structure, setup and README.
- **No earlier status or audit reports existed.** There was no root `docs/`, and `referral-intake/docs/` holds only three explainer docs, so nothing was skipped.
- **The repo was not modified.** Only `docs/STATUS-RUN.md` and this file were added.

---

## 1. Verdict

**DONE WITH GAPS.** v1 (items 1–10) runs end to end on a fresh clone with no keys (fixture extractor): fax → validation → 270/271 → review queue → approve → ORM^O01 → ACK, plus MCP. The committed Claude eval artifact backs the headline accuracy, cost and latency numbers.

**v2 (item 11) is not done:**
- The graph's own entry points crash.
- The graph is not served by the API or UI and has no human-in-the-loop.
- No v1-vs-v2 benchmark exists.
- The RAG does not install or bootstrap from the documented steps.

---

## 2. Scope

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Synthetic faxes (~60) + ground truth | **DONE** (truth has defects) | **Generator:** `corpus/generate_faxes.py` has 3 templates written inline as PIL functions (`:158-311`); `corpus/templates/` is empty. Degradation: skew, downscale to 200/150/120 dpi, noise, scan lines, 1-bit; margin notes on 15%, cover sheets on 20%.<br>**Fresh run:** `--seed 42 --count 60` → 60 PDFs in 8.4 s. `ground_truth.json` sha256 was identical on two runs and the PDFs were pixel-identical. 0 differences from the truth the eval used (1,140 values).<br>**Defects:**<br>• Laterality is chosen at random, ignoring the study text (`:395-398`). Mammography can be "n/a" while the study says "bilateral", and 10 of 60 rows contradict themselves.<br>• `patient_address` is in the truth for all 60, but only template_a prints it.<br>• Pixels depend on the host's fonts (`:15-37`). |
| 2 | OCR/vision extraction | **PARTIAL** | **Dispatch:** `app/extract.py:76-86` dispatches claude / textract / fixture; the default is textract (`:73`).<br>**Confidence:** Claude's is self-reported. Textract's is real. Fixture's is a fabricated hash.<br>**What ran:** Claude has a committed 60-fax run. Textract and Claude both NEED KEYS. Fixture ran end to end.<br>**Tesseract OCR baseline:** `ocr_baseline()` (`extract.py:66-69`) is **never called**. Tesseract is only used for highlight boxes (`locate.py`, errors swallowed at `extract_claude.py:110-119`). |
| 3 | Field validation | **DONE** | **Rules** (`app/validate.py:39-106`): NPI checksum with 80840 prefix, CPT catalog, CPT-to-study text coherence, laterality, ICD format/catalog/support, payor, member-ID regex, DOB range, confidence.<br>**Called from:** `pipeline.py:25` and the graph.<br>**Tests:** pytest 38/38, three runs, no flakes.<br>**Gaps:** not re-run after a reviewer correction; `is_auto_approvable` blocks on warnings too. |
| 4 | X12 270/271 eligibility | **DONE** (mock) | **Code:** `app/edi.py:18-105` builds a full ISA…IEA 270 and parses the 271; `app/payor.py:27-88` is a deterministic mock payor. 4 tests.<br>**Fresh run** over 60 faxes: 42 in-network / 5 out-of-network / 8 terminated / 5 not found. |
| 5 | Payor rules + policy retrieval (v2 RAG) | **PARTIAL** | **Rules:** `auth_packet.auth_requirement` (`:10-33`), called at `pipeline.py:30`.<br>**v1:** keyword retrieval `policy.retrieve` is **dead code**. Its only caller, `generate_packet`, is never called.<br>**v2:** `rag.retrieve_3step` runs pgvector cosine with a payor filter, blended with exact-code counts, then a keyword pick. It serves `/policy` and `/packet` and works after manual setup: 216 chunks from 24 docs, HTTP 200, 6 citations.<br>**Fresh clone:** 5 dependencies are undeclared. No code creates the `vector` extension or the `policy_chunks` table. `index_chunks.py` ignores `.env` and writes to `/faxtract` while the API reads `/referral`. Result: **`/policy` and `/packet` return 500.** The LLM keyword step runs only in `rag.py __main__`. |
| 6 | Prior-auth packet | **DONE** (needs #5's DB) | **Code:** `auth_packet.build_packet` (`:36-104`) cites the retrieved chunk ("Per <source>:").<br>**Fresh run:** `/packet` returned a 2-page PDF; the graph built 33 packets out of 60.<br>**Hard-coded:** the "prior imaging on file" and conservative-treatment boilerplate (`:85-91`). `prior_imaging` is always marked missing (`:21-22`). |
| 7 | React review queue | **PARTIAL** | **Build:** `npm ci && npm run build` passes (tsc + vite). The dev-server `/api` proxy reaches the API.<br>**Wired:** queue sorted worst-confidence first, fax viewer with box highlighting, Fax/Policy/Packet/Order tabs, approve/reject.<br>**Corrections broken for typed fields:** `PATCH` stores the UI's raw strings without validation (`ReviewPane.tsx:79`, `main.py:124-138`).<br>• A DOB correction makes approve return **500** (`'str' object has no attribute 'strftime'`).<br>• An ICD correction becomes **13 single-character DG1 segments**, which the RIS ACKs with AA.<br>**Persistence:** corrections and referrals live in memory only (`main.py:25-26`), so a restart loses them. |
| 8 | HL7 v2 ORM → mock RIS | **DONE** | **Code:** `hl7.build_orm` writes MSH/PID/PV1/ORC/OBR/DG1/ZDS. The MLLP client is `hl7.send_mllp` (`:58-68`); there is no `app/mllp.py` in any ref.<br>**Fresh run:** upload → PATCH → approve → `sent_to_ris`, RIS log `accepted order …`, `MSA\|AA`. A malformed message gets `MSA\|AE`. 6 faxes went through.<br>**Gaps:** with the RIS down, approve returns 500 and the status stays `approved`. Auto-approved referrals are never sent. `RIS_MLLP_*` env vars are never read. |
| 9 | MCP server over the RIS | **DONE** | `ris/mcp_server.py` has 5 tools: search_patient, get_orders, get_order, create_order, update_coverage.<br>**Fresh run:** a Python stdio client listed and called all 5, and **saw the orders the MLLP side stored** (both use `ris/orders.json`).<br>**Not tested:** "from a Claude session".<br>**Fragile:** `mcp` is unpinned. `MCPServer` imports on mcp 2.3.0 but fails on 1.x. |
| 10 | Eval harness | **PARTIAL** | **Code:** `evals/run_evals.py` + `scoring.py` implement per-field accuracy, a threshold sweep from 0.50 to 0.95, auto- and false-approval rates, cost and p50/p95 latency. `run_extraction_eval.py` + `report.html` cover extraction only.<br>**Committed:** the extraction artifact reproduces every number the README gives for accuracy, cost and latency.<br>**Not committed:** the sweep and false-approval output (`results.json` is gitignored).<br>**Data-loss bug:** running without keys does **not** refuse. It **overwrites the committed `extraction_eval.json` with 4.1%**, and `run_evals` writes 0% / $0.<br>**Narrow gate:** the sweep uses only `validate()`, not the eligibility/auth gate. |
| 11 | v2 graph pipeline + benchmark vs v1 | **PARTIAL** (graph) / **MISSING** (benchmark) | **Graph:** `graph/pipeline.py`, LangGraph, 9 nodes. It only runs standalone; neither the API nor the UI uses it.<br>**Entry points broken:**<br>• `python graph/pipeline.py` → `No module named 'graph'`<br>• `python -m graph.pipeline` → `ValidationError: 20 validation errors for Referral` at `:133`, because truth `boxes` are dicts but the model expects lists.<br>**Audit harness:** run through one, it does 60/60 (47 `order_ready`, 13 `coverage_exception`).<br>**Unfinished:**<br>• `human_review_node` does nothing: no interrupt, no checkpointer.<br>• `order_node` builds the ORM but never sends it.<br>• `retry_count`, `verification` and `human_correction` are unused.<br>**Benchmark:** none in any of 67 commits on any ref. The only mention is a comment in `graph/__init__.py:2`. |

### Git state
- **Local refs only; no fetch was run, so they may be stale.**
  - main = origin/main = `aecf845`.
  - Remote branches: `AaditAggarwal/DimerDAK` (00ab26d), `DhruvDS2/DimeHealth` (ce92db7), `novus/m-59rw2szm` and `novus/m-yvbpf376` (2704853), `novus/m-tkhh1x7a` (5198f73).
- **Unrelated histories.** main's root commit is `8ad9b20` and every remote branch's is `c85bee6`. The trees are identical; only the messages differ by one trailing newline. That is why `git log main..<branch>` lists everything.
- **Content unique to other branches**, checked by patch-id and tree comparison:
  - **DimerDAK commit `00ab26d` is not on main.** It contains:
    - the 4 missing pyproject dependencies (sqlalchemy, psycopg2-binary, pgvector, sentence-transformers);
    - an `index_chunks.py` bootstrap (CREATE EXTENSION, `create_all`, `load_dotenv`);
    - a page-PNG cache;
    - Textract box widening;
    - hover-zoom in the fax viewer.

    A trial cherry-pick conflicts only in `extract_textract.py`, where both sides add a function and keeping both resolves it.
  - Every other branch is fully contained in main.
- **v2 is on main by content:** 79e7dda ≡ f179a14 and 6347296 ≡ 3980736. The only missing v2 follow-up is 00ab26d.
- **Last 15 commits on main:**
  - `aecf845` Merge #9
  - `cd06aed` README results
  - `6536b1e` Merge #8
  - `a8c0c99` Extraction eval harness
  - `e4afdad` Field highlighting
  - `53d6c44` Merge #5
  - `1224ebf` Merge #6
  - `77508ae` .env.example
  - `e2dbf1c` Merge Textract+UI into pgvector
  - `b9deccb` Merge #4
  - `3980736` pgvector retrieval
  - `ac98bdf` Merge #3
  - `41d5910` Textract + UI
  - `96c6281` Combine imports
  - `3475757` Merge origin/main into DimerDAK

### Folder map
- **v1:**
  - `app/pipeline.py`, which is canonical; the API and evals use it.
  - The `POST /referrals` and `/approve` routes.
  - `evals/run_evals.py`.
  - The dead functions `policy.retrieve` and `auth_packet.generate_packet`.
- **v2:**
  - `graph/`.
  - `app/rag.py`, `app/vectorstore.py`, `app/db.py`.
  - `scripts/index_chunks.py`.
  - `corpus/generate_policies.py` and the 24 policies.
  - `referral-intake/docs/`.
  - The `/policy` and `/packet` routes and their UI tabs.
- **Shared:**
  - `models`, `extract*`, `locate`, `validate`, `edi`, `payor`, `hl7`, `auth_requirement` / `build_packet`.
  - `ris/`, the corpus generator, `scoring`, `run_extraction_eval`, `report.html`, `tests/`.
  - The core of `web/`.
- **What actually runs today:** v1 ingestion plus v2 retrieval inside one API. The v2 graph is never served.

---

## 3. Eval numbers

All "measured" values are recomputed from the per-file records in the committed `evals/extraction_eval.json` (Claude, 60 faxes). New keyed runs were not possible (NEEDS KEYS).

| Metric | Run-prompt claim | README claim | Measured | Verdict |
|---|---|---|---|---|
| CPT / ICD-10 / member ID / DOB / NPI | 100% | 100% | 60/60 each | ✅ |
| Patient name | 100% | 100% | last 60/60; **first 59/60** (referral_013: Clara → "Ciara", confidence 0.95) | ❌ |
| Overall field accuracy | – | 95.7% (1091/1140) | 95.7% (1091/1140) | ✅ |
| Accuracy excluding `patient_address` | – | "~98%" | 99.2% (1071/1080) | README understates |
| Fields at 100% | – | **17 of 19** | **13 of 19**. Below 100%: first_name 59, provider_name 59 (", MD" dropped), laterality 58, urgency 58, clinical_indication 57, patient_address 20 | ❌ |
| Cost per referral | ~$0.0145 | $0.0145 ($0.87 total) | $0.01454 ($0.8724). Uses hard-coded $3/$15 per Mtok | ✅ |
| Tokens | – | 129k in / 32k out | 129,227 / 32,315 | ✅ |
| Extraction latency | **~8.7 s** | p50 10.3 s, p95 12.8 s | mean 10.62 s, p50 10.32 s, p95 12.76 s (min 9.0, max 13.7) | README ✅. **8.7 s is stale**: it appears only in older README text (pre-`cd06aed`, and on the DimerDAK/novus branches), and no artifact backs it. |
| False approvals at 0.85 | 3 (2 GT laterality bugs, 1 Clara/Ciara) | – | **3**: 013 (name), 040 and 058 (laterality). 59 of 60 auto-approved at 0.85; 1 false approval at 0.90–0.95; never 0 at any threshold. | ✅ count, but **never recorded in any committed artifact**. Two lanes rebuilt it independently, each running the project's own `validate()` and `sweep_thresholds()`. |
| Model | – | claude-sonnet-4-6 | not recorded in the artifact; only the `MODEL` constant | gap |

**The laterality explanation is only half right.** Faxes 040 and 058 are CPT 77066, "Diagnostic mammography bilateral". The truth says `n/a` because the generator picks the side at random (`generate_faxes.py:398`). The page *prints* "Side: n/a", and the model answered "bilateral". So the ground truth contradicts itself, but the model also didn't copy the printed field.

**The confidence gate hardly filters:** 59 of 60 Claude extractions pass at 0.85.

### v1 vs v2
**No project benchmark exists.** The tables below were **measured by this audit, not taken from a project artifact.** They are offline and use the same 60 referrals.

Hit@1 counts a query as a hit when the top chunk comes from the correct payor+CPT policy.

| Retriever | Hit@1, full referral | Hit@1, CPT removed | p50 latency |
|---|---|---|---|
| v1 keyword (`policy.retrieve`) | 57/60 (95%) | 48/60 (80%) | 1.2 ms |
| v2 hybrid, NumPy (`rag.retrieve`) | 60/60 | 49/60 | 5.8 ms |
| v2 hybrid, pgvector (`retrieve_pg`) | 60/60 | 49/60 | 9.3 ms |
| v2 3-step (`retrieve_3step`, served) | 60/60 | 55/60 (92%) | 21 ms |

| Pipeline (fixture extraction, 60 faxes) | Mean latency | Outcome |
|---|---|---|
| v1 `app/pipeline.process` | 2.1 ms | 0/60 auto-approved (fixture confidences are fabricated); no retrieval or packet |
| v2 `graph` (run by audit harness) | 66 ms (p50 33, p95 206) | 47 `order_ready`, 13 `coverage_exception`, 33 packets; nothing sent to the RIS |

---

## 4. What's broken or missing, ranked

| # | Issue | Effort |
|---|---|---|
| 1 | **The eval runners destroy evidence when keys are missing.** `run_extraction_eval` overwrites the committed `extraction_eval.json` (→ 4.1%), and `run_evals` writes 0% / $0 results instead of refusing. | S |
| 2 | **Correction → approve corrupts or crashes orders.** A DOB string gives a 500, and the status is stuck at `approved`. An ICD string becomes 13 single-character DG1 segments that the RIS accepts. Validation and auth are not re-run after an edit. Fix: parse the PATCH through `Referral` and re-validate. | S–M |
| 3 | **RAG doesn't install or bootstrap from the README.** Undeclared: langgraph, sentence-transformers (+ torch), sqlalchemy, pgvector, psycopg2/psycopg3. No code creates the extension or table. The indexer and the API use different databases (`faxtract` vs `referral`). On a fresh clone `/policy` and `/packet` return 500. Most of the fix is already in DimerDAK `00ab26d`. | S |
| 4 | **The v2 graph demo is broken:** `ModuleNotFoundError` as a script, `ValidationError` at `:133` as a module. | S |
| 5 | **The v1-vs-v2 benchmark is missing** (the item 11 deliverable). The audit numbers above are a starting point; an end-to-end comparison needs keys. | M |
| 6 | **The v2 graph is not production-shaped:** not served, `human_review` is a no-op with no interrupt or checkpointer, and `order_node` never sends. | M–L |
| 7 | **Approving with the RIS down** returns 500 and leaves the status at `approved`. **Auto-approved referrals are never sent to the RIS.** | S |
| 8 | **Corrections and referrals are in memory only.** The "corrections table" feedback loop the README pitches doesn't survive a restart. | M |
| 9 | **The Tesseract OCR baseline is dead code** (`ocr_baseline` is never called), and no OCR-vs-vision comparison exists. | S (drop) / M (wire into eval) |
| 10 | **Ground-truth generator defects:** random laterality vs study text, and `patient_address` in the truth for templates that don't print it. Fixing them changes the truth, so the keyed eval must be re-run (~$0.87). | S + keys |
| 11 | **The false-approval and sweep results were never committed, and the run doesn't record the model ID.** The confidence gate passes 59 of 60. The sweep ignores the eligibility/auth gate. | S (commit) / M (gate work) |
| 12 | **Nothing is pinned.** `mcp` 1.x breaks the `MCPServer` import. | S |
| 13 | **Upload filename is not sanitized** (`main.py:31`, `UPLOADS / file.filename`). Path traversal on a local demo. | S |
| 14 | **No tests** for hl7, ris, mcp, rag, graph, pipeline or the API routes. The 38 existing tests pass. | M |
| 15 | **4 npm audit findings** (esbuild, nanoid, source-map-js; dev toolchain). | S |

**NEEDS KEYS:** `EXTRACTOR=claude` and `EXTRACTOR=textract` (uploads and both eval runners), `rag.extract_keywords_llm`, `scripts/check_aws.py`, and "MCP answers from a Claude session".

---

## 5. Structure recommendations

| Item | Recommendation | Effort | Risk | Why |
|---|---|---|---|---|
| Nested `referral-intake/` | **KEEP** | – (flattening would be L) | med if flattened | Data paths already resolve via `__file__`; only imports for `graph`, `scripts` and `corpus` need cwd = `referral-intake/`. Flattening would rewrite every documented path, conflict with open branches and fragment blame. Add a "`cd referral-intake`" line instead. |
| Two READMEs | **SMALL CLEANUP** | M | low | The root README is the original AI-written spec and contradicts the nested one in many places. Make the nested README the single technical source; cut the root one to a pitch plus a pointer. |
| Two `.gitignore`s | **SMALL CLEANUP** | S | low | The root patterns already cover the nested folder (no leading slash), so nested lines 1–4 duplicate them. Add `.DS_Store`, `.pytest_cache/`, `*.tsbuildinfo`. Narrow `*.csv`. |
| Tracked `corpus/out/referral_00{0,2}.raw.json` | **SMALL CLEANUP** | S | low | Committed before the ignore rule existed; stale. Remove with `git rm --cached`. |
| `evals/extraction_eval.json` + `report.html` | **KEEP** | – | – | They are the evidence for the README numbers. Note that the report's PDF links need a generated corpus, and fix bug #1 so they can't be overwritten. |
| `app/` vs `graph/` | **SMALL CLEANUP** | S | low | `graph/` reuses `app/` functions instead of copying them. Label `app/pipeline.py` canonical and `graph/` as v2, add `graph` to `packages`, and remove the duplicate `CLINIC_NPI` and the hard-coded 0.85. Don't merge the two yet. |
| Dead or duplicated code | **SMALL CLEANUP** | S | low | Dead: `policy.retrieve`, `generate_packet`, and the stale `TODO(claude-code)` in `policy.py:14`. Duplicated: `ris/server.py:11-22` re-implements `ris/store.py` with a separate lock over the same file. |
| `web/` | **KEEP** + S cleanup | S | low | The proxy and ports are right and the lockfile is consistent. Drop the unused `@radix-ui/react-dropdown-menu`. |
| `referral-intake/docs/` | **SMALL CLEANUP** | S | low | `pgvector-migration.md` predates the code: table `chunks` vs `policy_chunks`, and the `cpt` type differs. Mark it historical and link the docs from the README. |
| Empty `corpus/templates/` | **SMALL CLEANUP** | S | low | It backs the false "6 HTML templates" claim. |
| Bootstrap (`Makefile`) | **SMALL CLEANUP** | M | low | See §6. Compose is out of scope, so use a Makefile. |
| Remote branches | **SMALL CLEANUP** (Dhruv's call) | S | low | The novus/* and DimeHealth branches have no unique content. DimerDAK holds `00ab26d`. |

---

## 6. Setup and README issues

**A fresh clone does not run with one documented command.** The working sequence the audit actually found:
1. `cd referral-intake && python3 -m venv .venv && pip install -e .`
2. Install five more packages by hand. With the `.env.example` URL you also need `psycopg[binary]`.
3. Install tesseract and poppler.
4. Run Postgres with pgvector. The README's `postgres:16` image has none.
5. Create the database. The name must match `DATABASE_URL`, and the code (`faxtract`) and `.env.example` (`referral`) disagree.
6. `CREATE EXTENSION vector` and `Base.metadata.create_all`. **No code does this, and `schema.sql` doesn't exist.**
7. `DATABASE_URL=… python -m scripts.index_chunks`. This downloads an ~87 MB model on first use, which is undocumented.
8. `cp .env.example .env` and set `EXTRACTOR=fixture`.
9. Generate the corpus.
10. Start RIS, uvicorn and Vite in three terminals.

A single `make dev` would have to do all of this. It is S–M work, and DimerDAK `00ab26d` already covers steps 2, 6 and 7.

**`.env.example` is incomplete and partly wrong:**
- Never read: `RIS_MLLP_HOST`, `RIS_MLLP_PORT`, `CONFIDENCE_THRESHOLD`, `LANDING_API_KEY`.
- Read but missing: `POPPLER_PATH`, `PREVIEW_DPI`, `HIGHLIGHT`.
- `DATABASE_URL` default mismatch: `faxtract` vs `referral`.
- `rag.py:188` and `graph/pipeline.py:119` parse `.env` by hand and break on inline comments. The root README's env block has those comments, so copying it breaks both loaders.

**README issues, most misleading first:**

| Where | Claim | Reality |
|---|---|---|
| root:175 | `npm create vite@latest .` in `web/` | **WRONG.** It would scaffold over the existing UI. |
| root:172 / nested | Postgres via `docker run postgres:16` / no DB step | **WRONG/MISSING.** No pgvector, no DB, extension or table step. |
| root:164, nested:85 | install commands | **WRONG.** Each misses 5 dependencies. The root one has no `-e .`, so `python evals/run_evals.py` can't import `app`. `python` isn't on PATH on this Mac. |
| nested:59-65 | "17 of 19 fields at 100%", "two fields below 100%", "~98% excl. address" | **WRONG.** Actually 13/19, 6 fields below 100%, and 99.2%. |
| nested:46 | "keyword-overlap RAG over 12 docs" | **WRONG.** The served path is a 3-step pgvector hybrid over 24 docs. |
| root:79,118 | 6 clinic / 6 HTML templates | **WRONG.** 3 PIL templates; `templates/` is empty. |
| root:113,137,86,153 | `schema.sql`, `app/mllp.py`, `QueueTable.tsx`, `ReviewDetail.tsx` | **WRONG.** None exist. The UI is `components/QueueRail.tsx` and `ReviewPane.tsx`. |
| root:100-101 | WeasyPrint, TanStack Table | **WRONG.** Unused / absent; the UI uses Radix + Tailwind. |
| root:68,95,142 | Postgres-backed "corrections table"; in-memory `store.py` | **STALE/WRONG.** Corrections are in memory. Postgres holds only `policy_chunks`. `store.py` is a JSON file. |
| root:187-189 | `RIS_MLLP_*` and `CONFIDENCE_THRESHOLD` are configurable | **WRONG.** Hard-coded. |
| nested:15,45 | extraction is Claude vision | **STALE.** The default is Textract. |
| nested:39 | "9 passing tests" | **STALE.** 38 tests pass. |
| both | v2 | **MISSING.** No mention of `graph/`, pgvector, `index_chunks`, `rag.py`, `locate.py` or `referral-intake/docs/`. |
| nested:41,125-135 | "Status — complete"; build order includes "Deploy" | **STALE.** Graph HITL is a stub and no deploy exists. |
| root:94 / nested:43 | Python 3.11 / 3.10 | **STALE.** pyproject says `>=3.10`. Both 3.10 and 3.14 work. |
| root:103, 260 | "pytest for the eval harness"; "Need a human-in-loop at 2 steps." | **WRONG / stray note.** |

**Verified OK:**
- `generate_faxes` flags.
- Ports 2575 / 8000 / 5173.
- 5 MCP tools.
- The fixture engine is refused by evals.
- `.raw.json` saving.
- The edi/payor sanity snippet.
- Accuracy, cost and latency match the artifact.

---

## 7. Questions for Dhruv

| # | Question | Recommended default |
|---|---|---|
| 1 | Bring Aadit's `00ab26d` (DimerDAK: deps, index bootstrap, page cache, highlight zoom) onto main? | **Yes.** Cherry-pick it and keep both functions in the `extract_textract.py` conflict. It fixes most of issue #3. |
| 2 | What is v2's role: the served pipeline (the API calls the graph, with a real LangGraph interrupt for review), or a side-by-side benchmark harness? | **Benchmark harness for now.** Keep `app/pipeline.py` canonical, fix the graph entry point, and only promote v2 if the benchmark shows it wins. |
| 3 | What counts as "benchmarked against v1"? | **The same 60 faxes, measuring:** retrieval Hit@1 (full and CPT-removed), false approvals at 0.85, latency and cost per referral. Run offline with fixture, plus one keyed Claude run. Commit the result as `evals/benchmark_v1_v2.json`. |
| 4 | Fix the ground-truth generator (laterality, address) now? It changes the truth and needs a ~$0.87 keyed re-run. | **Yes**, the next time keys are available. Until then, document the 3 false approvals and the GT defects in a committed results file. |
| 5 | Tesseract OCR baseline: wire it into the eval as a comparison column, or drop the claim? | **Drop the claim** and keep Tesseract for highlighting only. Wiring it in is M effort for little demo value. |
| 6 | Which README is the source of truth? | **The nested `referral-intake/README.md`.** Cut the root one to a pitch plus "`cd referral-intake`". Keep the nested folder. |
| 7 | Delete the stale remote branches (novus/*, DimeHealth)? | **Yes, after #1 lands.** They have no unique content, and their history is unrelated to main's. |

---

## Audit notes
- **Networking:** pip and npm installs, plus a one-time HuggingFace download (all-MiniLM-L6-v2, ~87 MB) that the RAG code needs. No model APIs were called; no keys were present.
- **One accidental touch of your Postgres.** Lane B once ran `python app/rag.py` without `DATABASE_URL`, so `db.py` fell back to your local `localhost:5432/faxtract`. That path is a single read-only `SELECT … ORDER BY cosine_distance LIMIT 50` (`vectorstore.semantic_candidates`): no writes, DDL or commit. It is not known whether the connection succeeded. Nothing else touched port 5432. Every other DB step used a throwaway instance on 127.0.0.1:55432, which has been shut down.
- **Cleanup:** every process the audit started is stopped, and ports 2575, 8000, 5173 and 55432 are free. Scratch artifacts live under the session scratchpad: Lane B's clone and scripts in `laneB/`, Lane A's checkers in `laneA/`.
