# Resume plan: faxtract-v2-serve-and-ui (paused 2026-11-23)

> **Resumed and completed 2026-11-24.** The wrap-up below is done: `docs/gates/V2-UI-REPORT.md` is written and v2-ui is pushed. This file is kept as the record of the pause.

**Status at pause:**
- The run is paused at the very end of Phase 3.
- Every lane is done and merged into `v2-ui`.
- Every build/test gate passed on a fresh clone.
- **What's left:**
  1. Write `docs/gates/V2-UI-REPORT.md`.
  2. A final push.
  3. Print the preview commands and the CONTEXT block.

**Files:**
- Run prompt and amendment: `docs/V2-UI-RUN.md`
- Contracts: `docs/CONTRACTS.md`
- Audit: `docs/gates/STATUS.md`

**main:** `aecf8458d206b1b90730f6165abcee648b7120d6`, identical before the run and at the pause. Nothing was committed, merged or pushed to main.

## Lanes

Every lane is **done (100%) and merged** into v2-ui. Each `lane/*` branch is pushed to origin for backup.

| Lane | Branch @ tip | Delivered |
|---|---|---|
| A backend | `lane/a-backend` @ `83ea0fe` | The full API (§5). PATCH coercion: a DOB string or an ICD string is no longer a 500, and there are no one-character DG1 segments. RIS down gives `ris_error` rather than a stuck `approved`. Also: retry, corrections in Postgres, upload-name sanitising, v1 runner, RIS fault injection, retrieval-compare. |
| B setup | `lane/b-setup` @ `242c016` | Complete deps (`mcp==2.3.0`, psycopg3, Python ≥3.12). `.env.example` lists exactly the variables read. Also: bootstrap, index, seed, `make demo` with no Docker needed, `app/pages.py` page cache. |
| C graph | `lane/c-graph` @ `cadd229` | The served LangGraph: real `interrupt()`, Postgres checkpointer, `order` sends over MLLP and records the ACK, `ris_wait` retry, own trace with state diffs. Also: `structure()`, the v1-vs-v2 benchmark, the GT generator fix, box recording rewritten from scratch. |
| D ui-queue | `lane/d-ui-queue` @ `c14bbf2` | The queue screen and referral detail. Detail covers react-pdf with field boxes, inline edit with 422 errors, 270/271, citations, Compare v1 vs v2, packet, ORM + ACK and the actions. |
| E ui-graph | `lane/e-ui-graph` @ `3c717de` | The pipeline graph (React Flow, live node states, path taken, node state diff, Fix & resume), Evals, and RIS orders with retry. |

**Orchestrator commits on v2-ui:**
- Phase 0: contracts, safety, Textract/Aadit removal, web scaffold.
- Contract fixes after Lane A's report.
- Trace advisory lock.
- Integration fixes: runner `ValueError` → 409; compare computes auth.
- Shared-UI fixes.
- Phase 2 docs.
- Evals rendering fix.
- Gate artifacts.

The tip of `v2-ui` is the commit that adds this file.

## Gates (Phase 3)

| Gate | Result |
|---|---|
| Full pytest (`TEST_DATABASE_URL` set) | **189 passed, 0 failed, 0 skipped** |
| `npm run build` | **0 TypeScript errors** |
| Fresh clone + `make demo` | **exit 0 in 130 s.** Seeded 57 referrals: 19 sent (AA), 31 needs review, 4 rejected, 3 `ris_error` (1 AE, 2 RIS-down), 0 failed. Ran on ports 8095/5195 because 8000/5173 are held by another local project ("kindling") and 8090 by a `python -m http.server`. |
| Playwright `demo` (90-second script) | **passed.** Video: `docs/gates/demo.webm` (39 s) |
| Playwright `screens` (5 tests) | **passed.** 21 screenshots in `docs/gates/screens/`. Checked: the uploaded referral appears in the queue, and its trace marks every node on its path done. |
| README numbers trace to committed artifacts | done. The table "Where each number comes from" is in `referral-intake/README.md` |

## Next step when resuming (nothing left to merge)
1. **Write `docs/gates/V2-UI-REPORT.md`** with:
   - the amendment log: no cherry-pick (it was done, then dropped from v2-ui's unpushed history); Textract/AWS/`check_aws` removed; no LangSmith; screen 3 became the Pipeline graph; Compare v1 vs v2; the "Demo in 90 seconds" script;
   - the Aadit-removal list (§11 of `docs/CONTRACTS.md` plus the lane rewrites);
   - the residual boilerplate blame matches: blank lines, imports, `index.html`/`.gitignore` boilerplate, Box/Eligibility field declarations, two one-line calls in the generator. No Aadit logic remains;
   - main's hash before and after (both `aecf845…`);
   - the gate results above;
   - the README-number trace list;
   - the remote branches to clean up later (not in this run): `novus/m-59rw2szm`, `novus/m-tkhh1x7a`, `novus/m-yvbpf376`, `DhruvDS2/DimeHealth`.
2. **Push v2-ui** (normal push).
3. **Print the preview commands** and the CONTEXT FOR CLAUDE block (≤60 lines), then STOP.

## Open questions (with the default used)
1. **Ports 8000/5173 are busy on this machine.** The demo takes `DEMO_ARGS="--api-port … --web-port …"`. Default: keep 8000/5173 as the documented defaults.
2. **Python ≥3.12 is now required** by the pinned floors (numpy 2.5.5); 3.10 was dropped. Default: accept it.
3. **The keyed re-extraction of the fixed corpus** (about $0.87; within the approved $3) is NEEDS KEYS, because there is no `ANTHROPIC_API_KEY`. Default: run `EXTRACTOR=claude python -m evals.run_extraction_eval`, then `python -m evals.benchmark`, when a key exists.
4. **Optional polish:**
   - Lane E asks to move `features/graph/DataTable.tsx` into `components/`.
   - The mock record `m05040` has a status/trace mismatch (mock mode only).
   - `evals/scoring.sweep_thresholds` still uses the validate-only gate.

   Default: leave all three for a later run.
5. **`.worktrees/integ`** is a throwaway detached trial-merge worktree. Default: `git worktree remove .worktrees/integ`.

## How to resume
```bash
cd ~/personal-projects/faxtract && git checkout v2-ui && git pull --ff-only origin v2-ui
claude "Resume the run in docs/V2-UI-RUN.md from docs/RESUME-PLAN.md: only the Phase 3 wrap-up is left (V2-UI-REPORT.md, push v2-ui, preview commands, CONTEXT block). Never touch main."
```

**Preview the app locally:**
```bash
cd ~/personal-projects/faxtract && git checkout v2-ui && cd referral-intake
make demo                                                    # or, if 8000/5173 are busy:
make demo DEMO_ARGS="--api-port 8095 --web-port 5195"        # then open http://127.0.0.1:5195/queue
make demo-stop
```
