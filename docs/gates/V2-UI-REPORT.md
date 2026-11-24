# V2-UI report: faxtract-v2-serve-and-ui (P0)

- **Run:** 2026-11-23 → 2026-11-24, with one pause (`docs/RESUME-PLAN.md`).
- **Prompt:** `docs/V2-UI-RUN.md`, including the AMENDMENT.
- **Contracts:** `docs/CONTRACTS.md`.
- **Starting audit:** `docs/gates/STATUS.md`.

## Verdict
**DONE.** The graph is the served pipeline, with a real human-in-the-loop pause, Postgres checkpoints, a real MLLP send and the RIS ACK. There is a benchmark against v1, and the five-screen UI is new. Every gate passed on a fresh clone of `v2-ui`:
- the one-command demo;
- the Playwright demo, with video;
- screenshots of every screen;
- 189 tests, with 0 failures and 0 skips.

## main is untouched

| | Hash |
|---|---|
| main before the run | `aecf8458d206b1b90730f6165abcee648b7120d6` |
| main after the run | `aecf8458d206b1b90730f6165abcee648b7120d6` (local and `origin/main`) |

**Nothing went to main.** No commit, merge, rebase, reset or push touched it, and no PR was opened.

**Pushed to origin, all normal pushes:**
- `v2-ui`;
- the five lane branches, pushed at the pause because you asked: `lane/a-backend`, `lane/b-setup`, `lane/c-graph`, `lane/d-ui-queue`, `lane/e-ui-graph`.

No tags were pushed and no branches were deleted.

## Amendment log (received during Phase 0, applied immediately)

| # | Amendment | What was done |
|---|---|---|
| 1 | No cherry-pick of `00ab26d`, no code from `AaditAggarwal/*`. Remove Textract, AWS and `check_aws`. Lane B re-implements deps, the index bootstrap and the page cache. Replace the old UI and any served Aadit code. | `00ab26d` had already been cherry-picked onto the **unpushed** v2-ui. That commit was **dropped from v2-ui's history** (reset, then the work re-applied), so it is in no pushed history.<br>Textract, AWS, `check_aws` and their tests were removed.<br>Lane B re-implemented the deps, index bootstrap and `app/pages.py` page cache from scratch.<br>The UI was replaced wholesale.<br>All Aadit-authored served code was rewritten (list below). |
| 2 | No LangSmith or LangChain-hosted services or keys. | LangGraph runs locally. `graph/__init__.py` forces `LANGSMITH_TRACING` and `LANGCHAIN_TRACING_V2` to false. Tracing is our own (`app/trace.py`, `trace_events` in Postgres). |
| 3 | Screen 3 becomes **Pipeline graph**. | `GET /graph/structure` returns `build_graph().get_graph()` (introspected, never hardcoded), rendered with React Flow.<br>Node states, with live polling: done, running (pulse), paused at `human_review`, skipped, error.<br>The path taken is highlighted.<br>Clicking a node shows its input/output state diff, duration, cost, tokens, and every attempt (retries).<br>**Fix & resume** goes to the edit view.<br>The PIPELINE badge sits in the header. |
| 4 | "Compare v1 vs v2" on the referral detail. | `GET /referrals/{id}/retrieval-compare` runs v1 keyword retrieval and v2 3-step hybrid RAG on the same query. The panel shows them side by side, with scores, latency and the expected policy document. |
| 5 | README "Demo in 90 seconds". The Playwright video follows the script. | `web/e2e/demo.spec.ts` follows the script step by step and recorded `docs/gates/demo.webm` (39 s). |

## Decisions (as applied)
1. **Superseded by amendment 1** (see above).
2. **`PIPELINE=graph|v1`, default `graph`.** The API serves either runner under one contract. `app/pipeline.py` is untouched as the v1 baseline and served through `app/runner_v1.py`.
3. **Human in the loop.** `human_review` calls LangGraph `interrupt()`, with `PostgresSaver` checkpoints (thread id = referral id). Review actions resume the run: edit loops back through `validate` and pauses again, approve goes to `order`, reject ends it. `order` sends `ORM^O01` over MLLP and records the ACK. A failure pauses at `ris_wait`, and retry resumes it.
4. **Benchmark:** `evals/benchmark_v1_v2.json` and `.md` (numbers below).
5. **Ground truth fixed.**
   - Laterality now follows the study and the ICD codes.
   - Address is in the truth only when printed.
   - Box recording was rewritten.
   - The RNG stream is preserved.
   - The keyed re-run is **NEEDS KEYS**: there is no `ANTHROPIC_API_KEY`, so **$0.00 of the approved $3 was spent**. `evals/cost_log.jsonl` was never written, because no keyed run happened.
6. **Tesseract baseline claim dropped.** `ocr_baseline()` was deleted. Tesseract remains only for locating Claude's values (`app/locate.py`).
7. **The nested README is the source of truth.** The root README is a pitch and a pointer.
8. **Remote branch cleanup: not done, as instructed.** Candidates for later:
   - `origin/novus/m-59rw2szm`, `origin/novus/m-tkhh1x7a`, `origin/novus/m-yvbpf376`, `origin/DhruvDS2/DimeHealth`: no unique content, per STATUS.md.
   - `origin/AaditAggarwal/DimerDAK`: holds the unused `00ab26d`.
   - The five `lane/*` branches, now fully merged into v2-ui.

## Lanes (all merged into v2-ui in the order B, A, C, D, E, with no conflicts)

| Lane | Tip | Delivered |
|---|---|---|
| B setup | `242c016` | Complete `pyproject` (`mcp==2.3.0`, psycopg3, Python ≥3.12).<br>`.env.example` lists exactly the 13 variables the code reads (test-enforced).<br>Bootstrap (`init_db`, index, graph setup) and the seed script.<br>`make demo` / `demo-stop` / `test`, with a project-local Postgres and no Docker.<br>`app/pages.py`. |
| A backend | `83ea0fe` | The full HTTP API.<br>PATCH coercion: a DOB string or an ICD string is a 422 or coerced, never a 500 and never one-character DG1 segments.<br>RIS down gives `ris_error` and is retryable; a record is never stuck in `approved`.<br>Persisted corrections, a sanitised upload path, the v1 runner, RIS AE fault injection, retrieval-compare, and the trace and evals endpoints. |
| C graph | `cadd229` | The served LangGraph: interrupt, checkpointer, MLLP send and ACK, `ris_wait` retry.<br>Per-node trace with `state_in` and `delta`.<br>`structure()`, the benchmark, the GT fix and new box recording. |
| D ui-queue | `c14bbf2` | **Queue:** TanStack Table, filters, `j`/`k`/Enter, upload.<br>**Detail:** react-pdf with field boxes, inline edit with per-field 422 errors, 270/271, citations, Compare v1 vs v2, packet, ORM + ACK, Approve/Edit/Reject. |
| E ui-graph | `3c717de` | **Pipeline graph:** its own layered layout, live states, the path taken, node diffs, Fix & resume.<br>**Evals:** every number read at runtime, with source and run timestamp.<br>**RIS orders:** ACK, attempts and Retry. |

**Orchestrator commits on v2-ui:**
- Phase 0: contracts, safety guards, Textract/Aadit removal, the web scaffold with DESIGN.md, the mock backend.
- Contract fixes after Lane A's report:
  - `replayed_latency_ms` is an int, which unblocked v1 under replay;
  - `PolicyResult`;
  - timezone-aware defaults.
- A per-referral advisory lock in `trace.emit`.
- Integration fixes in lane code:
  - a runner `ValueError` → 409;
  - compare computes auth when the pipeline didn't.
- A follow-up sent back to Lane C: always evaluate auth after eligibility, so a paused referral shows its prior-auth picture.
- Shared-UI fixes: no retry on 4xx, HL7 vs X12 splitters, toast offset.
- Phase 2 docs.
- Evals rendering polish.
- Gate artifacts.

## Gates

| Gate | Result |
|---|---|
| Full pytest (merged v2-ui, `TEST_DATABASE_URL` set) | **189 passed, 0 failed, 0 skipped** |
| `npm run build` | **0 TypeScript errors** (strict) |
| Fresh clone of v2-ui → `make demo` (one command) | **exit 0 in 130 s.** Install, demo Postgres, bootstrap (216 policy chunks), corpus, RIS/API/web, seed.<br>**Seed:** 57 referrals: 19 sent (AA), 31 needs review, 4 rejected, 3 `ris_error` (1 AE, 2 RIS down), 0 failed.<br>**Ports:** 8000/5173 are held by another local project, so `DEMO_ARGS="--api-port 8095 --web-port 5195"`. |
| Playwright `demo`: upload → queue → nodes light up → pause → edit → approve → ORM → ACK → evals | **passed.** Video `docs/gates/demo.webm` (39 s) |
| Playwright `screens`: every screen and state, plus the gate assertions (the upload is in the queue; its trace marks every node on its path done) | **5/5 passed.** 21 PNGs in `docs/gates/screens/` |
| Every README number traces to a committed artifact | yes (below) |

**Screenshots:**

| Screen | Files |
|---|---|
| Demo sequence | `demo-01-graph-running`, `demo-02-graph-paused`, `demo-03-fix-field`, `demo-04-ack`, `demo-05-graph-sent`, `demo-06-evals` |
| Queue | `queue`, `queue-needs-review` |
| Referral detail | `detail-needs-review`, `detail-edit-422`, `detail-compare-v1-v2`, `detail-reject-dialog`, `detail-sent-aa`, `detail-ris-error`, `detail-rejected` |
| Pipeline graph | `graph-empty`, `graph-paused`, `graph-sent`, `graph-ris-error-node-panel` |
| Evals and orders | `evals`, `orders` |

## Numbers (all from committed artifacts)

**Extraction** (`evals/extraction_eval.json`: one real Claude run over 60 faxes, scored against the pre-fix truth):
- **Accuracy:** 95.7% (1091/1140). 13 of 19 fields are at 100%, including CPT, ICD-10, member ID, DOB, last name, NPI and payor.
- **First name 59/60:** referral_013 prints "Clara", and the model read "Ciara" at 0.95.
- **Cost:** $0.0145 per referral ($0.8724 for 60).
- **Latency per fax:** p50 10.3 s, p95 12.8 s, mean 10.6 s.
- **Correction to an earlier claim:** the old README said "17/19 at 100%" and "~8.7 s". Both were wrong, and both are corrected.

**v1 vs v2** (`evals/benchmark_v1_v2.json`: the same 60 faxes, replayed extraction, threshold 0.85, truth version `as_printed`):

| | v1 | v2 (served graph) |
|---|---|---|
| Retrieval Hit@1, with CPT | 57/60 | **60/60** |
| Retrieval Hit@1, CPT removed | 48/60 | **55/60** |
| Auto-approved | 19 | 19 |
| False approvals | 1 (referral_040) | 1 (referral_040) |
| Latency p50 / p95 (no human) | 0.4 / 4.1 ms | 56.8 / 122.2 ms |
| Cost per referral | $0.0145 | $0.0145 |

- **The single false approval.** referral_040 is "bilateral" read from a page that printed "n/a". That page was the generator's defect, now fixed, so the case should disappear on re-extraction.
- **The "3 false approvals" claim** used `validate()` alone. The full gate holds 013 and 058 for coverage and prior-auth reasons, not because it caught the errors.

**README number trace list:**

| README numbers | Artifact |
|---|---|
| 95.7%, 13/19, every per-field score and miss, $0.0145, $0.8724, tokens, 10.3 / 12.8 / 10.6 s | `evals/extraction_eval.json` |
| Hit@1, auto-approved, false approvals, latency, per-node timings, the "3 vs 1" analysis | `evals/benchmark_v1_v2.json` / `.md` |
| GT defects, 45 changed files, 1,270 identical values, 50 identical pages | `evals/GT_NOTES.md`, `evals/gt_changes.json`, `tests/test_corpus_truth.py` |
| 57 seeded referrals | `scripts/seed_demo.py` output (labelled as not committed) |

## Aadit-authored code: everything removed or replaced
Identified with `git blame -C -C -M` over main's tree at the start of the run.

**Removed:**
- `app/extract_textract.py`
- `scripts/check_aws.py`
- `tests/test_extract_textract.py`, `tests/test_poppler.py`, `tests/test_extract_fixture.py`, `tests/test_corpus_boxes.py`
- The entire old `web/src`: `App.tsx`, `api.ts`, `index.css`, `main.tsx`, `index.html`, `components/` (CommandPalette, Dialogs, EvidencePanels, EvidenceTabs, FaxViewer, FieldsPanel, QueueRail, ReviewPane, WelcomePane, `ui/*`) and `lib/*`
- `boto3`, and every AWS variable
- `PREVIEW_DPI` and `HIGHLIGHT`
- `LANDING_API_KEY`

**Rewritten from scratch:**

| File | Done by |
|---|---|
| `app/extract.py`, `app/extract_fixture.py`, `app/models.Box`, the header of `app/extract_claude.py`, the Textract bits of `evals/run_evals.py`, `evals/scoring.SCORED_FIELDS`, `web/` config and `package.json` | orchestrator |
| `app/main.py` (page rendering, `PREVIEW_DPI`) | Lane A |
| `.env.example`, `pyproject.toml`, the page cache | Lane B |
| Box recording in `corpus/generate_faxes.py` | Lane C |

**Residual blame matches on v2-ui:** about 100 lines, all boilerplate rather than logic:
- blank lines and `import` statements;
- standard `index.html` and `.gitignore` entries;
- the `Box` / `Eligibility` field declarations, which are dictated by the data contract;
- two one-line calls in the generator (`degrade(cover_sheet(...))`, `pages.append(cover)`).

No served path depends on Aadit-authored logic.

## Deviations and notes
- **Dependency versions:**
  - TanStack Table is pinned to **v8.21** (well documented; v9 changed the API).
  - React 19 and Vite 8: react-pdf 11 requires React 19.
  - Python ≥3.12 is now required by the tested floors.
- **Docker** isn't available here. The demo runs a project-local Postgres; `docker-compose.yml` (Postgres only) is untested.
- **Ports:** 8000/5173 on this machine belong to another project. The documented defaults are unchanged and `DEMO_ARGS` overrides them.
- **No API key.** The demo and benchmark use `EXTRACTOR=replay`: the committed real Claude predictions, including their real errors. The extraction eval runners refuse to run without a key and never overwrite the artifact.
- **Open, optional:**
  - promote `features/graph/DataTable.tsx` to `components/`;
  - a status/trace mismatch in the mock record `m05040` (mock mode only);
  - `scoring.sweep_thresholds` still uses the validate-only gate;
  - remove the throwaway `.worktrees/integ`.
- **NEEDS KEYS:**
  - the keyed re-extraction of the fixed corpus (about $0.87);
  - the LLM keyword step in RAG;
  - driving MCP from a Claude session.

## Preview it locally
```bash
cd ~/personal-projects/faxtract
git fetch origin && git checkout v2-ui && git pull --ff-only origin v2-ui
cd referral-intake
make demo                                                  # http://127.0.0.1:5173/queue
# if 8000/5173 are busy on your machine:
make demo DEMO_ARGS="--api-port 8095 --web-port 5195"      # http://127.0.0.1:5195/queue
make demo-stop                                             # when done (make demo-clean also wipes .demo/)
```
