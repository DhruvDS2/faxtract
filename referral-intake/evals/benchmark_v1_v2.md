# Benchmark: v1 vs v2 (served graph)

Generated from `evals/benchmark_v1_v2.json` by `python -m evals.benchmark` (2026-11-24T01:34:56.411767Z, commit `ab18836c74`). Do not edit by hand.

60 faxes, extraction `replay` (evals/extraction_eval.json), auto-approve threshold 0.85, truth version **as_printed**.

| | v1 (`app/pipeline.py`) | v2 (served graph) |
|---|---|---|
| Retriever | app.policy.retrieve (keyword overlap, whole documents) | app.rag.retrieve_3step (3-step hybrid RAG on pgvector) |
| Retrieval Hit@1, with CPT | 57/60 (95%) | 60/60 (100%) |
| Retrieval Hit@1, CPT removed | 48/60 (80%) | 55/60 (92%) |
| Auto-approved at 0.85 | 19/60 | 19/60 |
| False approvals | 1 ['referral_040.pdf'] | 1 ['referral_040.pdf'] |
| Latency p50 / p95, ms (no human, replayed extraction) | 0.4 / 2.9 | 53.0 / 100.3 |
| Recorded extraction latency p50 / p95, ms | 10324.6 / 12757.5 | 10324.6 / 12757.5 |
| Cost per referral | $0.0145 | $0.0145 |

## v2 per-node timings (ms, from trace events)

| Node | runs | p50 | p95 | mean |
|---|---|---|---|---|
| extract | 60 | 0.12 | 0.25 | 0.15 |
| validate | 60 | 0.08 | 0.26 | 0.11 |
| eligibility | 60 | 0.19 | 0.31 | 0.22 |
| auth | 47 | 0.06 | 0.18 | 0.08 |
| retrieve | 33 | 26.31 | 57.12 | 30.55 |
| packet | 33 | 6.50 | 10.32 | 6.97 |
| human_review | 41 | 0.05 | 0.07 | 0.05 |
| order | 19 | 1.66 | 4.10 | 1.98 |

v1 stage timings (ms): extract 0.10 / 0.22, validate 0.04 / 0.17, eligibility 0.08 / 0.19, send 1.85 / 3.51 (p50 / p95).

## False approvals

- **referral_040.pdf**, `laterality`: predicted `bilateral`, truth `n/a`, confidence 0.99 (v1, v2). referral_040.pdf (template_b, clean scan): the model read laterality as 'bilateral' where the page shows 'n/a', with 0.99 confidence, above the 0.85 threshold. CPT 77066 (Diagnostic mammography bilateral) does not require a side, so validation accepts any value. Coverage came back active in network, and Cascade Mutual needs no prior auth for this study, so the gate auto-approved it (v1 and v2) and the ORM went to the RIS with laterality = 'bilateral'. The printed 'n/a' was itself a ground-truth generator defect: the old generator drew the side at random instead of taking it from the study ("Diagnostic mammography bilateral" cannot be n/a) or from the right-sided ICD-10 codes. The fixed generator prints 'bilateral', which is what the model answered, so this case is expected to disappear when the fixed corpus is re-extracted (NEEDS KEYS).

## Truth versions

post-fix ground truth (corpus/generate_faxes.py at this commit), except that on the 10 pages whose print the fix changed (evals/gt_changes.json, printed=true) the changed fields keep the value the pre-fix page printed, because the replayed prediction was read off that page. Retrieval's expected doc uses the post-fix payor + CPT (unchanged by the fix).

| Truth version | v1 false approvals | v2 false approvals |
|---|---|---|
| as_printed | 1 ['referral_040.pdf'] | 1 ['referral_040.pdf'] |
| pre_fix | 1 ['referral_040.pdf'] | 1 ['referral_040.pdf'] |
| post_fix | 4 ['referral_017.pdf', 'referral_027.pdf', 'referral_036.pdf', 'referral_039.pdf'] | 4 ['referral_017.pdf', 'referral_027.pdf', 'referral_036.pdf', 'referral_039.pdf'] |

## Notes

- Same gate in both pipelines (app.gate.review_reasons): they agree on 60/60 auto-approve decisions, so the comparison is orchestration and retrieval, not rules.
- Orders really sent: v1 19 and v2 19 got MSA|AA from the in-process mock RIS (38 orders in its store).
- Latency is end to end per referral with replayed extraction and no human time: v1 = process() + gate + MLLP send; v2 = GraphRunner.start() to its pause or end, including the Postgres checkpoint and trace writes, the 3-step RAG and the prior-auth packet PDF that v1 never does. One untimed warm-up run per pipeline first (model load, connection pool).
- Where v2's time goes: the nodes' own work is p50 27.6 ms per referral; the rest (p50 25.5 ms, p95 61.3 ms) is LangGraph bookkeeping plus the Postgres checkpoint after every step and two trace rows per node, i.e. the price of pausable, resumable, inspectable runs. Next to the ~10 s model call it is noise.
- Retrieval latency per query: v1 p50 2.0 ms / p95 4.8 ms, v2 p50 25.9 ms / p95 70.6 ms. Both retrievers get the same referral (the replayed prediction); the expected doc is section 15's payor+CPT policy (app.rag.expected_source).
- Hit@1 misses: v1 with CPT ['referral_004.pdf', 'referral_009.pdf', 'referral_054.pdf'], v1 without CPT ['referral_001.pdf', 'referral_004.pdf', 'referral_009.pdf', 'referral_010.pdf', 'referral_013.pdf', 'referral_019.pdf', 'referral_023.pdf', 'referral_034.pdf', 'referral_041.pdf', 'referral_043.pdf', 'referral_054.pdf', 'referral_059.pdf']; v2 with CPT [], v2 without CPT ['referral_010.pdf', 'referral_023.pdf', 'referral_041.pdf', 'referral_049.pdf', 'referral_059.pdf'].
- The served graph only retrieves when prior auth is required (33/60 referrals); its top citation matches the direct retrieve_3step call on 33/33.
- The earlier '3 false approvals' claim used validate() alone, with pre-fix truth: that narrow gate auto-approves 59/60 and falsely approves 3 (referral_013.pdf, referral_040.pdf, referral_058.pdf). The full gate (validation + eligibility + prior-auth elements) auto-approves 19 and falsely approves 1 under the same pre-fix truth (referral_040.pdf). The others are held for coverage or prior-auth reasons, not because the gate noticed the wrong value.
- False approvals by truth version (v1 / v2): as_printed 1 / 1; pre_fix 1 / 1; post_fix 4 / 4. post_fix scores the stale replays of reprinted pages against values those pages never showed, so it overstates errors; as_printed is the headline.
- Cost per referral is the recorded Claude token usage x app.contracts.PRICE_PER_MTOK; v2 adds no model calls (its step-2 keyword extractor is deterministic), so both pipelines cost the same.
