RUN NAME: faxtract-status-check (P0)
Model: Opus, xhigh. Max 3 agents. Save this prompt as docs/STATUS-RUN.md.
READ-ONLY RUN: no code changes, no moves, no refactors. Only write to docs/gates/. Running tests, evals and the pipeline on the synthetic corpus is allowed. Network only for package installs, the model APIs the pipeline already uses, and localhost. Never print secrets. This is a fresh clone with no .env: if keys are missing, run everything that works without them, mark the rest "NEEDS KEYS", and continue.

══ PHASE −1: RECONCILE ══
Check docs/ and docs/gates/ for earlier status or audit reports. Skip re-verifying anything that is clearly unchanged since then. Judge from code and real runs, not README claims or commit messages.

══ ORIGINAL SCOPE (check every item) ══
1. Synthetic fax PDFs (corpus, ~60 docs) with ground truth
2. OCR/vision extraction
3. Field validation
4. X12 270/271 eligibility
5. Payor rules + policy retrieval (v2: full RAG)
6. Prior auth packet generation
7. React review queue
8. HL7 v2 ORM to a mock RIS
9. MCP server over the RIS
10. Eval harness (claimed: 100% on CPT/ICD-10/member ID/DOB/name/NPI, ~$0.0145/referral, ~8.7s extraction, 3 false approvals: 2 ground-truth laterality bugs, 1 Clara/Ciara misread)
11. v2: graph-engineering pipeline + full RAG, benchmarked against v1

══ PHASE 1: LANES (parallel, read-only) ══
LANE A scope + git: For each scope item, give a DONE / PARTIAL / MISSING / BROKEN verdict with evidence (file paths and what runs). Git state: branches, last 15 commits on main, anything only on other branches, and whether v2 is fully on main. Map which folders are v1, v2 and shared.
LANE B run + evals: Install from scratch following the README. Run the test suite, the v1 pipeline, the v2 pipeline and the eval harness. Compare the numbers to the claims, and give the v1 vs v2 benchmark table if it exists. List failures, flaky steps and anything NEEDS KEYS.
LANE C structure + setup: Review the repo layout (nested referral-intake/ folder, duplicate README/.gitignore, app vs graph, web). Is .env.example complete? Does a fresh clone run with one documented command? Is the README accurate? Give a recommendation for each item: KEEP / SMALL CLEANUP / RESTRUCTURE, with effort S/M/L and risk. Don't recommend a restructure unless it clearly pays off.

══ PHASE 2: REPORT ══
Write docs/gates/STATUS.md:
1. Verdict: DONE / DONE WITH GAPS / NOT DONE (one line why)
2. Scope table (item | verdict | evidence)
3. Eval numbers: claimed vs measured, v1 vs v2
4. What's broken or missing, ranked (effort S/M/L)
5. Structure recommendations
6. Setup/README issues
7. Questions for Dhruv, each with a recommended default
Then print a "CONTEXT FOR CLAUDE" block of at most 60 lines summarizing all of the above, so it can be pasted into a chat. STOP after that.
