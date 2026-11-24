RUN NAME: faxtract-v2-serve-and-ui (P0)
Follow docs/ORCHESTRATOR.md if present: one worktree per lane in ./.worktrees/<name>, file ownership, frozen contracts. Model: Opus, xhigh. Max 5 agents.
Save this prompt as docs/V2-UI-RUN.md (on v2-ui). Source of truth for what's broken: docs/gates/STATUS.md.

══ BRANCH RULES (hard) ══
- Create branch `v2-ui` from current main. ALL work happens on v2-ui: lane branches are cut from v2-ui and merge back into v2-ui.
- NEVER commit to, merge into, rebase, reset, or push main. Never open a PR. main must be byte-identical at the end of this run (verify with git rev-parse main before/after and report both hashes).
- Pushing v2-ui to origin is allowed (normal push, no force) as a backup. Nothing else goes to the remote: no tags, no branch deletes.
- No deploys, never print or commit secrets. Network only for package installs, the model APIs the pipeline already uses, and localhost. NEVER fall back to a default DATABASE_URL: if it's unset, fail loudly. Keyed eval runs are approved up to $3 total; log the cost of every run.

══ PHASE −1: RECONCILE ══
Read docs/gates/STATUS.md and any docs/*-RUN.md. If v2-ui already exists, resume it. Check v2-ui and every worktree; mark each item below DONE / PARTIAL / TODO from code and real runs. Skip DONE; finish only the missing part of PARTIAL.

══ DECISIONS ══
1. Cherry-pick DimerDAK 00ab26d onto v2-ui.
2. graph/ becomes the SERVED pipeline. app/pipeline.py stays as the v1 baseline. The API picks via PIPELINE=graph|v1 (default graph).
3. Human-in-the-loop: the graph pauses at human_review for any referral below the 0.85 auto-approve threshold or failing validation, persists its state in Postgres, and resumes when the reviewer approves/edits/rejects in the UI. Use the graph library's own interrupt + checkpointer if it has one; otherwise persist state in the DB and resume on approve. order_node really sends ORM to the RIS and records the ACK.
4. Benchmark = same 60 faxes, v1 vs v2: retrieval Hit@1 (with and without CPT), false approvals at 0.85, latency p50/p95, cost/referral, plus per-node timings for v2. Commit as evals/benchmark_v1_v2.json plus a markdown table.
5. Fix the GT generator (laterality vs study text; decide whether address belongs in truth), then do one keyed re-run if keys exist; otherwise document the defects and mark NEEDS KEYS.
6. Drop the Tesseract baseline claim.
7. Nested referral-intake/README.md is the source of truth. The root README becomes a short pitch + pointer.
8. Remote branch cleanup (novus/*, DimeHealth): NOT in this run. Just list them in the report.

══ UI SPEC (clinical ops tool: dense, calm, trustworthy; think Linear/Retool, not a marketing site) ══
- Tokens go in web/DESIGN.md; every UI lane follows it. Neutral gray scale, ONE accent (deep teal), status colors only for status (green approved/sent, amber needs review, red rejected/error, gray pending). Inter for UI, JetBrains Mono for codes (CPT, ICD-10, NPI, member ID, HL7). Base 13–14px, 4px spacing grid, 6px radius, 1px borders, no gradients, no heavy shadows. Light mode first; dark mode if cheap.
- Libraries: keep the current React/Vite stack. Add TanStack Table + TanStack Query, react-pdf for the fax viewer, and shadcn/ui (Radix) primitives. Don't hand-roll tables, dialogs or PDF rendering.
- Screens:
  1. Queue: table of referrals (patient, CPT, payor, confidence, status, age); filter by status/payor; sort; keyboard nav (j/k, enter). Empty, loading and error states.
  2. Referral detail: split view. Left = fax PDF with extracted-field bounding boxes; clicking a field highlights it. Right = extracted fields, editable inline with validation errors shown, then eligibility 270/271 result, policy citations (RAG chunks with source + score), prior-auth packet preview, HL7 ORM preview + RIS ACK. Approve / Edit / Reject buttons resume the graph.
  3. Pipeline trace: per-referral timeline of graph nodes (status, duration, cost, retries, branch taken).
  4. Evals: v1 vs v2 benchmark from evals/benchmark_v1_v2.json, plus field accuracy and the 3 false-approval cases with explanations. Show the source file + run timestamp. Every number is read at runtime, nothing hardcoded.
  5. RIS orders: sent orders with ACK status (AA/AE) and a retry button for failed sends.
- Demo mode: a seed script loads the 60 faxes with a realistic mix (auto-approved/sent, needs review, rejected, RIS error).

══ PHASE 0: CONTRACTS + SAFETY (orchestrator, serial, on v2-ui) ══
- Eval runners refuse to run without keys and never overwrite committed artifacts (write to a temp path, replace only on success).
- One DB name everywhere. DATABASE_URL is required.
- Freeze and commit: the Referral model, PATCH payload, review-action API (approve/edit/reject → resume), referral status enum, trace event shape, benchmark JSON schema, and web/DESIGN.md. Lanes ask the orchestrator to change any of these.

══ PHASE 1: LANES (parallel; UI lanes build against stubs/mocks of the frozen contract until backend lanes merge) ══
LANE A backend-correctness (owns app/ API layer, ris/ glue): PATCH goes through Referral validation and re-runs validation (a DOB fix must not 500; ICD edits must not become one-char DG1 segments). RIS-down: clean error + correct status, no stuck "approved". Persist reviewer corrections. Sanitize the upload filename. Review-action endpoints. Trace events API. Tests for each.
LANE B setup (owns pyproject, docker/compose, .env.example, scripts/): cherry-pick 00ab26d; declare all deps (incl. psycopg3); pin mcp to the tested version; pgvector image + extension/tables + index bootstrap; seed script for demo mode; one command (docker compose up, or make demo) that brings up DB + API + web + RIS on a fresh clone; .env.example lists exactly the vars that are read. Verify from a fresh clone of v2-ui in a temp dir.
LANE C graph-served (owns graph/, evals/): fix the entry point (boxes dict vs list); HITL interrupt/resume per decision 3; order_node sends + records ACK; emit trace events per node; wire behind PIPELINE=graph; benchmark per decision 4; GT generator fix per decision 5. Tests: an auto-approve path, a pause → approve → send path, a reject path, and a RIS-down path.
LANE D ui-queue+detail (owns web/src/features/queue, web/src/features/referral): screens 1–2.
LANE E ui-trace+evals+ris (owns web/src/features/trace, evals, orders): screens 3–5.

══ PHASE 2: DOCS (after A–E merge into v2-ui) ══
Rewrite the README claims to match committed artifacts only (name 59/60 with the Clara/Ciara explanation, fields-at-100% count, latency from the artifact, cost). Remove nonexistent files/tests and the destructive "npm create vite" instruction. Add an architecture diagram (graph nodes + HITL), the v1-vs-v2 table, a false-approval analysis, and a "Run the demo" section. Cleanups: dedupe .gitignore, untrack stale corpus/out/*.raw.json, label app/ = v1 baseline and graph/ = served v2, delete dead keyword retrieval only if the benchmark doesn't need it, mark pgvector-migration.md historical.

══ PHASE 3: QA + GATE ══
Merge order into v2-ui: B, A, C, then D and E, then docs. Gates: full pytest green; npm run build with 0 TypeScript errors; fresh-clone one-command demo works; Playwright end-to-end: upload fax → appears in queue → edit a field → approve → ORM sent → ACK shown → trace shows every node. Save screenshots of every screen and state to docs/gates/screens/, plus a 30-60s demo video of that flow. Every README number traces to a committed artifact (list them).
Push v2-ui to origin. Write docs/gates/V2-UI-REPORT.md, including main's hash before/after (must match). Print the exact commands for me to preview it locally (checkout v2-ui, start the demo, URL to open). Print a "CONTEXT FOR CLAUDE" block of at most 60 lines. STOP.
