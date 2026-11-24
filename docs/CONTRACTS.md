# v2-ui run: frozen contracts, ownership, rules

This file is written by the orchestrator and is **frozen** for this run. Lanes build against it.

To change anything marked frozen:
1. Stop.
2. Write the request in your final report (or message the orchestrator).
3. Build against the current contract in the meantime.

The run prompt is `docs/V2-UI-RUN.md`, with its amendment logged in `docs/gates/V2-UI-REPORT.md`. The audit behind it is `docs/gates/STATUS.md`. All paths below are relative to `referral-intake/` unless they start with `docs/`.

## 0. Hard rules (every lane)
- **Branches.**
  - Work only on your lane branch `lane/<name>` in your worktree `.worktrees/<name>`.
  - Never touch `main`: no checkout, commit, merge, rebase, reset or push.
  - Never push anything and never open a PR. The orchestrator merges lanes into `v2-ui` and pushes `v2-ui`.
- **Commits.** Commit often, with small messages. Use the identity the orchestrator gives you through env vars. Don't edit git config.
- **No Aadit code.** Use no code from any `AaditAggarwal/*` branch. Files on v2-ui that still contain Aadit-authored lines are listed in §11. Their owners rewrite them from scratch: don't paste, don't "lightly edit".
- **Network** is allowed for package installs only. That includes the one-time HuggingFace download of `all-MiniLM-L6-v2`, which is already cached, so run with `HF_HUB_OFFLINE=1`. Localhost is fine.
  - No LangSmith, no LangChain-hosted services, no LangChain or LangSmith API keys. LangGraph runs locally. `graph/` sets `LANGSMITH_TRACING=false` and `LANGCHAIN_TRACING_V2=false` at import.
- **Secrets.** Never print or commit them. There are no API keys in this environment: anything that needs one is **NEEDS KEYS**.
- **DATABASE_URL is required.** No code may default it. If it's unset, raise `app.db.DatabaseNotConfigured`, which fails loudly. The project database is named **`faxtract`** everywhere.
- **Stay in your files.** Edit only files your lane owns (§2). Read anything.
  - If you need a change in someone else's file, put it in your report as a request. Don't make it.
  - New files go inside your owned folders.
- **Shared environment.** Don't install packages into the shared venv. If you need a new Python or npm package, ask in your report (exception: Lane B verifies a fresh clone in its own temp venv). UI lanes run `npm ci` in their own worktree's `web/`.
- **Clean up.** Stop every server you start before you finish.

## 1. Shared environment for lanes

| What | Value |
|---|---|
| Python venv (all deps pre-installed, project **not** installed) | `$SCR/venv/bin/python`. Run from `referral-intake/` so `app`, `graph`, `ris`, `evals`, `scripts` and `corpus` import from **your** worktree. Pytest has `pythonpath=["."]`. Outside pytest, set `PYTHONPATH=.` |
| Postgres server (pgvector, TCP only, trust auth) | `127.0.0.1:55433`, user `postgres` |
| Your lane database | `postgresql+psycopg://postgres@127.0.0.1:55433/faxtract_<lane>`, e.g. `faxtract_a`. Create it with `psql -h 127.0.0.1 -p 55433 -U postgres -c 'create database faxtract_a'`, then call `app.db.init_db()` |
| Tests | `TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55433/postgres`. The `db` fixture makes a throwaway database per test |
| Corpus | `corpus/out` is gitignored. Generate it in your worktree with `python corpus/generate_faxes.py --seed 42 --count 60` (or use the `corpus` pytest fixture) |
| HF model | already cached; export `HF_HUB_OFFLINE=1` |

`$SCR` = `/private/tmp/claude-501/-Users-dhruvsharma-personal-projects-faxtract/7e8a1313-fbab-491e-90f2-c86fc951d259/scratchpad`

**Ports.** Use your block only. Defaults are reserved for Lane B's fresh-clone demo check and for the orchestrator's QA gate.

| Lane | API | RIS (MLLP) | Web |
|---|---|---|---|
| A backend | 8101 | 2601 | – |
| B setup (demo defaults) | 8000 | 2575 | 5173 (+ demo Postgres 55432) |
| C graph | 8301 | 2603 | – |
| D ui-queue+detail | 8401 (only if you run a real API) | – | 5174 |
| E ui-graph+evals+orders | 8501 (only if you run a real API) | – | 5175 |

The web dev server reads `WEB_PORT` and `API_URL`. Mock mode is `npm run dev:mock`, which needs no backend.

## 2. Ownership

| Lane | Owns (create/edit/delete) |
|---|---|
| **Orchestrator** (frozen) | `app/contracts.py`, `app/db.py`, `app/trace.py`, `app/gate.py`, `app/extract.py`, `app/extract_replay.py`, `app/extract_fixture.py`, `app/models.py`, `graph/service.py` **signatures**, `tests/conftest.py`, `evals/safety.py`, `docs/**`, `web/DESIGN.md`, `web/package.json` + lockfile, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/{main.tsx,contracts.ts}`, `web/src/app/**`, `web/src/api/**`, `web/src/components/**` (ui primitives + shared), `web/src/lib/**`, `web/src/styles/**`, `web/public/mock/**`, root `README.md`, `.gitignore` files |
| **A**: backend-correctness | `app/main.py` and any new `app/api/*.py` routers, `app/store.py` (tables + repository), `app/runner_v1.py` (new: v1 `PipelineRunner` around `app/pipeline.process`), `app/hl7.py` (RIS client env + errors), `app/coerce.py` (new: PATCH coercion), `app/retrieval_compare.py` (new), `ris/**`, `tests/test_api_*.py`, `tests/test_ris_*.py`, `tests/test_store_*.py`, `tests/test_hl7*.py` |
| **B**: setup | `pyproject.toml`, `Makefile` (new, inside `referral-intake/`), `docker-compose.yml` + `docker/**` (new), `.env.example`, `scripts/**` (index bootstrap, seed, demo runner), `app/pages.py` (new: the page/PDF cache, used by A's routes), `tests/test_setup_*.py`, `tests/test_pages*.py` |
| **C**: graph-served | `graph/**` (implements `graph/service.py`), `evals/**` except `evals/safety.py` and the committed `evals/extraction_eval.json`, `corpus/generate_faxes.py`, `corpus/build_fixtures.py`, `corpus/generate_policies.py`, `app/rag.py`, `app/policy.py` (read-mostly; benchmark needs v1 keyword retrieval), `tests/test_graph_*.py`, `tests/test_evals_*.py`, `tests/test_corpus_*.py` (replace the Aadit-authored `test_corpus_boxes.py`) |
| **D**: ui-queue+detail | `web/src/features/queue/**`, `web/src/features/referral/**` |
| **E**: ui-graph+evals+orders | `web/src/features/graph/**`, `web/src/features/evals/**`, `web/src/features/orders/**` |

Unowned shared app modules (`app/validate.py`, `app/edi.py`, `app/payor.py`, `app/auth_packet.py`, `app/locate.py`, `app/extract_claude.py`, `app/pipeline.py`, `app/vectorstore.py`) are **read-only for lanes**. `app/pipeline.py` is the v1 baseline and stays as-is. If you need one of them changed, ask.

## 3. Environment variables (the complete list; `.env.example` must list exactly these)

| Var | Read by | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | `app/db.py` | **none: required** | `postgresql+psycopg://user@host:port/faxtract` (`postgresql://` is accepted too) |
| `PIPELINE` | API (`app.contracts.pipeline_name`) | `graph` | `graph` or `v1` |
| `EXTRACTOR` | `app/extract.py` | `claude` | `claude`, `fixture` or `replay` |
| `ANTHROPIC_API_KEY` | anthropic SDK (claude engine) | – | NEEDS KEYS |
| `CONFIDENCE_THRESHOLD` | `app.contracts.confidence_threshold` | `0.85` | both pipelines, the gate and `/health` |
| `RIS_MLLP_HOST` / `RIS_MLLP_PORT` | `app/hl7.py` client, `ris/server.py` listener | `127.0.0.1` / `2575` | |
| `RIS_STORE_PATH` | `ris/server.py`, `ris/store.py` | `ris/orders.json` | |
| `RIS_FAULT_LAST_NAMES` | `ris/server.py` | empty | comma list. An ORM whose PID last name matches gets `MSA\|AE\|…\|simulated RIS rejection`. Demo only, stated in the UI |
| `REPLAY_PACE_S` | API upload default | `0` | replay sleeps `min(recorded latency, this)` seconds per extraction. The demo sets it (e.g. `12`) so nodes light up at real speed |
| `UPLOADS_DIR` | API | `uploads/` | each upload is stored at `uploads/<referral_id>/<sanitized original name>` |
| `POPPLER_PATH` | `app/extract.py` | PATH | only if pdftoppm isn't on PATH |
| `HF_HUB_OFFLINE` | sentence-transformers | – | optional |

**Gone (amendment):** every AWS var, Textract, `HIGHLIGHT`, `LANDING_API_KEY`, `PREVIEW_DPI` (pages are rendered client-side).

## 4. Referral lifecycle (frozen)

Status values are `app.contracts.ReferralStatus`: `processing`, `needs_review`, `auto_approved`, `approved`, `sent_to_ris`, `ris_error`, `rejected`, `failed`.

```
upload ──► processing ──(pipeline)──► needs_review ──edit──► needs_review   (graph re-validates, pauses again)
                │                          │──approve──► approved ──send──► sent_to_ris | ris_error
                │                          └──reject───► rejected
                ├──(gate clean)──► auto_approved ──send──► sent_to_ris | ris_error
                └──(crash)───────► failed
ris_error ──retry-send──► sent_to_ris | ris_error      ris_error ──reject──► rejected
```

**The gate** is `app.gate.review_reasons(flags, eligibility, auth)`. An empty list means auto-approve. It is identical to v1's rule:
- no validation flags at the threshold;
- eligibility active (in or out of network);
- no missing prior-auth elements.

Both pipelines use the same gate, so the benchmark compares orchestration, not rules.

**Approve:**
- returns 409 when any **error**-severity flag remains (`app.gate.blocking_flags`); warnings are the reviewer's call;
- returns 409 unless the status is `needs_review`.

**Edit:**
- allowed only in `needs_review`;
- re-runs validation and the downstream checks (graph: resume with an edit, which loops back to `validate` and pauses again at `human_review`);
- never auto-sends: a human approves.

**Reject:** allowed in `needs_review` or `ris_error`. `reason` is required.

**Retry-send:** allowed only in `ris_error`. It re-sends the stored ORM and increments `order.attempts`.

**A send never leaves `approved` or `auto_approved` at rest.** On AA the status is `sent_to_ris`. On AE, AR, connection refused or a timeout it is `ris_error`, with `order.last_error` set and the ACK recorded. The HTTP call returns 200 with the record; RIS trouble is not a 500.

## 5. HTTP API (frozen; implemented by Lane A; mirrored in `web/src/contracts.ts`, `web/src/api/client.ts`)

Bodies and responses are the Pydantic models in `app/contracts.py`. Every 4xx from these routes has the shape `ErrorBody`: `{detail, errors[], status, flags[]}`.

| Method + path | Request | Response | Errors |
|---|---|---|---|
| `GET /health` | – | `Health` | – |
| `POST /referrals` | multipart `file` (PDF), optional form `pace_s` (float), query `wait=1` | `202 ReferralRecord` (status `processing`; the run continues in a background thread). With `wait=1`: `201` after the pipeline settles | `400` not a PDF |
| `GET /referrals?status=&payor=` | – | `ReferralSummary[]`, unsorted | – |
| `GET /referrals/{id}` | – | `ReferralRecord` | `404` |
| `GET /referrals/{id}/fax.pdf` | – | the stored PDF (`application/pdf`, `ETag` + `Cache-Control: private, max-age=3600`) | `404` |
| `GET /referrals/{id}/pages/{n}.png` | – | page PNG, using Lane B's `app/pages.py` cache (for thumbnails / non-JS use) | `404` |
| `PATCH /referrals/{id}` | `ReferralPatch` | `ReferralRecord` | `422` unparseable or unknown field (`errors[]` per field). `409` not `needs_review` |
| `POST /referrals/{id}/approve` | `ApproveBody` (optional) | `ReferralRecord` (`sent_to_ris` or `ris_error`) | `409` blocking flags or wrong state |
| `POST /referrals/{id}/reject` | `RejectBody` | `ReferralRecord` | `422` missing reason. `409` wrong state |
| `POST /referrals/{id}/retry-send` | – | `ReferralRecord` | `409` not `ris_error` |
| `GET /referrals/{id}/trace` | – | `TraceEvent[]` ordered by `seq` | `404` |
| `GET /referrals/{id}/policy` | – | `PolicyResult` `{required, keywords, citations: PolicyCitation[]}`: the record's citations if the pipeline stored them, else computed | – |
| `GET /referrals/{id}/packet` | – | `application/pdf` | `409` no auth required |
| `GET /referrals/{id}/order` | – | `OrderPreview` (the ORM that would be or was sent) | – |
| `GET /referrals/{id}/retrieval-compare?k=5` | – | `RetrievalCompare` (v1 `app.policy.retrieve` vs v2 `app.rag.retrieve_3step`, same query, side by side) | `409` no payor or no auth needed (message says why) |
| `GET /referrals/{id}/corrections` / `GET /corrections` | – | `Correction[]` (persisted) | – |
| `GET /graph/structure` | – | `GraphStructure` from `graph.service.structure()`, i.e. `build_graph().get_graph()`. Never hardcoded. Always the v2 graph; `active_pipeline` tells the UI what is being served | – |
| `GET /orders` | – | `RisOrderRow[]`: every referral with ≥1 send attempt, with `in_ris` checked against the RIS store | – |
| `GET /evals/benchmark` | – | `ArtifactEnvelope` over `evals/benchmark_v1_v2.json` (`run_at` = its `generated_at`) | `404` not generated |
| `GET /evals/extraction` | – | `ArtifactEnvelope` over `evals/extraction_eval.json` (`run_at` = `summary.run_at` if present, else the file's last git commit time with `run_at_source="git"`, else `unknown`) | `404` |

CORS is not needed: the UI goes through the Vite proxy at `/api`.

**PATCH coercion.**
- Values are coerced through `Referral`. `patient_dob` and `order_date` accept `YYYY-MM-DD` (and `MM/DD/YYYY`). `icd10_codes` accepts a list or a string split on `,`, `;` or whitespace, uppercased and stripped. Empty string means `null`.
- `confidence` and `boxes` are not editable (422).
- Each changed field writes a `Correction` with the original and corrected values and the original confidence, and sets that field's confidence to 1.0.

## 6. Pipeline runners (frozen interface: `app.contracts.PipelineRunner`)

```python
class PipelineRunner(Protocol):
    name: Literal["graph", "v1"]
    def start(self, referral_id, pdf_path, source_name, replay_pace_s=0.0) -> ReferralRecord: ...
    def resume(self, record: ReferralRecord, action: ReviewAction) -> ReferralRecord: ...
```

**The API:**
1. Picks the runner by `PIPELINE`: `graph.service.GraphRunner()` or `app.runner_v1.V1Runner()`.
2. Persists every returned record.
3. Owns status checks (409s), PATCH coercion and the corrections log.
4. Calls `resume` with `ReviewAction(kind="edit", referral=<coerced full Referral>, changed_fields=[...])`, or `approve`, `reject` or `retry_send`.

**Runners** compute and return the record. They never write the referrals table. They emit trace events with `app.trace.emit`.

**Graph runner (Lane C):**
- **State and checkpointing.** LangGraph `StateGraph` with `langgraph.checkpoint.postgres.PostgresSaver` on `app.db.libpq_url()`. `thread_id` is the referral id. `setup()` creates the checkpointer tables.
- **The pause.** A real `langgraph.types.interrupt()` in `human_review`. Resume with `Command(resume=<action dict>)`.
- **Retries.** RIS retry is a resume too, e.g. `order` → `ris_wait` interrupt → `retry_send` → `order`. The design is C's; it just has to come from the graph.
- **Required node names:** `extract`, `validate`, `eligibility`, `auth`, `retrieve`, `packet`, `human_review`, `order`. You can add more, such as `reject` or `ris_wait`.
- **Branches:**
  - Eligibility not active → review, with a reason.
  - Auth required → retrieve → packet.
  - Gate clean → `order` (auto). Otherwise → `human_review`.
  - `human_review`: approve → `order`, edit → `validate` (loop), reject → `reject` → END.
- **`order` really sends** the ORM over MLLP (`app.hl7.send_mllp`, `RIS_MLLP_*`), parses the ACK and records `OrderInfo`.
- **`structure()`** returns `build_graph().get_graph()` mapped to `GraphStructure`. `interrupts=True` marks the nodes that can pause.

**v1 runner (Lane A):**
- Wraps `app.pipeline.process`, which stays untouched.
- `start` emits one trace event per v1 stage from `stage_timings_ms`.
- On resume it re-validates through `app.validate.validate` and sends through the same RIS client.
- Everything is v1 semantics, under the frozen lifecycle.

**Trace emission (both runners):**
- Per node execution, emit `status="running"` at start (`duration_ms=0`, `state_in=None`, `delta=None`), then one closing event (`ok` / `error` / `interrupted`) with `duration_ms`, cost and tokens (`extract`: `app.contracts.token_cost(usage)`), `attempt`, `branch` (the next node chosen, for routing nodes), `state_in` (the JSON-safe state the node received, **without** `referral.boxes`) and `delta` (what the node wrote).
- `run_id` is new per `start` or `resume` call.

## 7. Persistence (Postgres `faxtract`)

| Table | Owner | Notes |
|---|---|---|
| `policy_chunks` | `app/vectorstore.py` (existing) | pgvector, indexed by `scripts/index_chunks.py` (Lane B bootstrap) |
| `trace_events` | `app/trace.py` (orchestrator) | `TraceEvent` rows |
| referrals, corrections, ris sends | `app/store.py` (Lane A) | records as JSON plus indexed `status` / `payor` / `created_at` |
| LangGraph checkpoints | `graph.service.setup()` (Lane C) | |

`app.db.init_db()` creates the extension and all `Base` tables. The bootstrap calls `init_db()` and then `graph.service.setup()`.

## 8. Extraction engines (orchestrator; frozen)
- **`claude`:** live, NEEDS KEYS. Boxes come from `app/locate.py` (local Tesseract).
- **`fixture`:** corpus ground truth, generator boxes, invented confidences.
- **`replay`:** the committed real Claude run (`evals/extraction_eval.json`) with generator boxes. Keyless, real model errors included. `extract(pdf, replay_pace_s=...)`.
- Both corpus engines match the file name's `referral_NNN`, so the API must keep the original file name inside `uploads/<id>/`.
- The eval runners refuse fixture and replay, refuse claude without a key, write atomically, and log cost to `evals/cost_log.jsonl`.

**Ground-truth format (Lane C keeps it):** `corpus/out/ground_truth.json` is `{ "referral_NNN.pdf": { <Referral fields>, "template", "degradation", "pages", "boxes": { field: {page, left, top, width, height} } } }`. Boxes are normalised 0–1 after skew. If C changes what a page **prints**, list the pages in `evals/gt_changes.json`, because replayed predictions for those pages become stale.

## 9. Benchmark (`evals/benchmark_v1_v2.json`, schema = `app.contracts.BenchmarkReport`, `schema_version: 1`)
- Same 60 faxes, `EXTRACTOR=replay`, `threshold` from config.
- **v1:** `app/pipeline.process` + gate, retrieval with `app.policy.retrieve`.
- **v2:** the served graph, run to its first pause or end with no human, retrieval with `app.rag.retrieve_3step`.
- **Retrieval Hit@1:** does the top chunk's doc match the payor+CPT policy for the referral? Measure it with the CPT code and with the CPT code removed.
- **False approval:** auto-approved with at least one critical field wrong vs ground truth (`evals/scoring.CRITICAL_FIELDS`).
- **Latency:** p50/p95 end to end, excluding human time. Report recorded extraction latency separately, from the artifact.
- **Cost per referral** comes from recorded tokens × `PRICE_PER_MTOK`.
- **v2 per-node timings** come from trace events.
- **Each false approval** gets a `FalseApprovalCase` with a plain-English `explanation`.
- **Also write** `evals/benchmark_v1_v2.md`: the table, generated from the JSON, never hand-typed.
- **State the truth version** (pre- or post-GT-fix) in `corpus`.

## 10. UI routes (frozen; the shell is orchestrator-owned)
- `/queue`: D
- `/referrals/:id`, with `?edit=1` opening edit mode: D
- `/graph?referral=<id>`: E. "Fix & resume" links to `/referrals/<id>?edit=1`.
- `/evals`: E
- `/orders`: E

The header shows the `PIPELINE` badge (`GET /health`). Use `web/src/api/queries.ts` hooks and `web/src/api/client.ts`. Use the shared components and `web/DESIGN.md` tokens: no new colours, no hand-rolled tables, dialogs or PDF rendering.

**Mock mode** (`npm run dev:mock`) serves realistic data built from the real pipeline pieces. Build against it until the backend merges; then verify against a real API.

## 11. Aadit-authored code still on v2-ui (owners rewrite from scratch; listed in the final report)

| File | Aadit lines (blame -C -C -M) | Owner | Action |
|---|---|---|---|
| `app/main.py` | 11/157 (page rendering, `PREVIEW_DPI`, pagecount import) | A | rewrite the whole API module |
| `corpus/generate_faxes.py` | 112/499 (`value_boxes`, `rotate_boxes`, `_drawn_forms`, box recording in `main`) | C | re-implement box recording yourself |
| `tests/test_corpus_boxes.py` | 84/84 | C | delete; write your own |
| `.env.example` | 5/9 | B | rewrite |
| `pyproject.toml` | 1 (`boto3`) | B | rewrite deps |
| `referral-intake/.gitignore` | 1 (`*.csv`) | orchestrator (Phase 2) | |
| `referral-intake/README.md` | 1 | orchestrator (Phase 2) | |

**Already removed or rewritten by the orchestrator in Phase 0:**
- **Removed:** the Textract engine, `scripts/check_aws.py`, `tests/test_extract_textract.py`, `tests/test_poppler.py`, `tests/test_extract_fixture.py`, and the whole old `web/` UI. The old UI's code was 100% Aadit: QueueRail, ReviewPane, FieldsPanel, FaxViewer, EvidencePanels, EvidenceTabs, CommandPalette, Dialogs, WelcomePane, `ui/*`, `lib/*`, `App.tsx`, `index.css`, `api.ts`, `index.html`, `main.tsx` and `vite.config.ts`.
- **Rewritten:** `app/extract.py`, `app/extract_fixture.py`, `app/models.Box`, the head of `app/extract_claude.py`, the Textract bits of `evals/run_evals.py`, and `evals/scoring.SCORED_FIELDS`.
- **Never cherry-picked:** `00ab26d`. The cherry-pick was undone and v2-ui's history rewritten before any push.

## 12. Demo contract (Lane B builds it; the orchestrator's QA gate uses it)
- **One command from a fresh clone:** `make demo`, run inside `referral-intake/`. Docker isn't available on this machine, so it must work without Docker:
  1. Start a project-local Postgres with pgvector (`initdb` into `.demo/pg`, TCP-only on 127.0.0.1:55432) if `DATABASE_URL` isn't set. The demo script states the URL explicitly; app code never defaults it.
  2. Bootstrap: `init_db`, index chunks, `graph.service.setup()`.
  3. Generate the corpus.
  4. Start RIS :2575, API :8000 (`PIPELINE=graph EXTRACTOR=replay REPLAY_PACE_S=12`) and web :5173.
  5. Seed.

  Optionally, `docker compose up` (pgvector/pgvector:pg16) is documented as an alternative (it can't be verified here).
- **Seed mix**, through the HTTP API with `pace_s=0`, waiting for each referral to settle:
  - all 60 faxes, minus a few left out so the demo can upload them live;
  - auto-approved → sent (AA);
  - needs review;
  - some rejected (with reasons);
  - at least one `ris_error` from AE (`RIS_FAULT_LAST_NAMES`);
  - at least one `ris_error` from RIS-down (approve while the RIS is stopped, then restart it).
- `make demo-stop` stops everything. `make test` runs pytest against the demo Postgres.

## 13. Tests
- Fixtures in `tests/conftest.py`: `db` (fresh database), `ris_server` (MLLP on an ephemeral port with its own store), `ris_down` (a dead port), `corpus` (60 faxes).
- **The QA gate** runs `TEST_DATABASE_URL=… pytest` and requires **0 failures and 0 skips**.
- **Required tests:**
  - **A:** PATCH a DOB string → 200 with a date, no 500. PATCH an ICD string → a list, and the ORM has one DG1 per code. Unknown field → 422. Approve with blocking flags → 409. Approve with the RIS down → `ris_error` plus `last_error`, never stuck at `approved`. Retry-send → `sent_to_ris`. Upload filename traversal (`../../x.pdf`) is sanitised. Corrections survive an API restart (same DB). Trace API. Retrieval-compare.
  - **C:** auto-approve path (→ AA). Pause → approve → send. Edit → re-pause. Reject. RIS-down → `ris_error` → retry → AA. Interrupted state survives a fresh `GraphRunner` (checkpointer). `structure()` matches the compiled graph. Benchmark JSON validates against `BenchmarkReport`. GT fix keeps the RNG stream (unchanged rows byte-identical).
  - **B:** `.env.example` vars == the vars read by code (a test that greps). Bootstrap is idempotent. Page cache.

## 14. Reporting back (lane agents)
Your final message is your report. Include:
1. What you built (files).
2. How to run it.
3. Test results (command plus pass/fail/skip counts).
4. Anything you could not do, and why.
5. Change requests for frozen files.
6. NEEDS KEYS items.
7. The confirmation that all servers are stopped.
8. Your final commit hash on `lane/<name>`.

## 15. Cross-lane interfaces (frozen)
- **`app/pages.py` (Lane B implements; Lane A's routes call it, importing lazily inside the route):**
  - `pdf_bytes(path) -> tuple[bytes, str]` returns the content and a strong ETag, cached by (path, mtime, size).
  - `page_png(path, page: int, dpi: int = 150) -> bytes` renders a page, cached in a bounded LRU.
  - `page_count(path) -> int` is cached.

  Until B merges, A's page tests use `pytest.importorskip("app.pages")`. The skip goes away after the merge.
- **`app/hl7.py` (Lane A owns; Lane C calls it):**
  - Keep `build_orm(referral, order_id, mrn, message_id) -> str` and `send_mllp(message, host, port, timeout=10.0) -> str` call-compatible.
  - `build_orm` must emit one DG1 per ICD code.
  - A may add helpers, e.g. `parse_ack(ack) -> (code, text)` or `ris_address() -> (host, port)` from `RIS_MLLP_*`. C may use them after the merge but must not depend on them before it: C reads `RIS_MLLP_HOST`/`RIS_MLLP_PORT` itself and parses `MSA|<code>|…`.
- **IDs:**
  - The referral id is generated by the API: 8 lowercase hex characters (`uuid4().hex[:8]`).
  - `order_id = "ORD" + id.upper()`, `mrn = "MRN" + id.upper()`, `message_id = "MSG" + id.upper() + "-" + attempt`.
- **Packets:** the auth packet for a referral lives at `packets/<referral_id>.pdf` (gitignored). The graph's `packet` node writes it there. A's `GET /referrals/{id}/packet` serves that file if it exists, else builds it.
- **Expected policy doc:** used by retrieval-compare (A) and the benchmark (C). It is the policy document whose `payor` matches the referral's payor (`app.validate.match_payor`) and whose chunk metadata `cpt` contains the referral's CPT, from `app.rag.chunk_policies()`. If there is none, it is `None`. A source is identified by its file stem, e.g. `meridian-health__lumbar-mri`.
- **UI flow (demo script):** uploading from the queue navigates to `/graph?referral=<id>`, where the nodes light up. A paused referral shows **Fix & resume**, which goes to `/referrals/<id>?edit=1`. Approve runs the resume, sends the order and shows the ACK on the detail page. Then the Evals page.
- **E2E test ids** (`data-testid`; the orchestrator's Playwright test depends on them):

  | Screen | Test ids |
  |---|---|
  | Queue | `queue-table`, `queue-row` (with `data-id=<id>` and `data-status=<status>`), `upload-input` (the `<input type=file>`), `filter-status`, `filter-payor` |
  | Detail | `fax-viewer`, `field-<name>` (the value cell, or its input in edit mode), `field-error-<name>`, `btn-edit`, `btn-save`, `btn-cancel`, `btn-approve`, `btn-reject`, `reject-reason`, `btn-reject-confirm`, `btn-compare`, `compare-panel`, `order-message`, `order-ack` (text contains the ACK code), `detail-status` |
  | Graph | `graph-canvas`, `graph-node` (with `data-node=<id>` and `data-state=done\|running\|paused\|skipped\|error\|idle`), `node-panel`, `btn-fix-resume`, `referral-picker` |
  | Evals | `evals-benchmark`, `evals-source`, `evals-false-approvals`, `evals-field-accuracy` |
  | Orders | `orders-table`, `order-row` (with `data-id`), `btn-retry` |
