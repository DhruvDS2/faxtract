# Resume plan: faxtract-ui-upgrade (paused 2026-11-24, at Dhruv's request)

- **Run prompt and decision log:** `docs/UI-UPGRADE-RUN.md`
- **Conventions:** `docs/ORCHESTRATOR.md`
- **Design docs:** `docs/design/` (AUDIT, PROPOSAL, refs/, before/)
- **Untouched:** `main` (`aecf845`) and `v2-ui` (`9d89626`). Nothing was committed, merged or pushed to either.

## Where it stands
**Phases done:**
- **Phase −1:** reconciliation.
- **Phase 0:**
  - 48 before-screenshots;
  - reference verification (the details.so MCP was out of credits, so references were verified from their public pages; logged);
  - AUDIT and PROPOSAL;
  - the graph-style decision: a clean left-to-right flow map, plain language first.
- **Phase 1:** tokens and base components, merged.

**Phase 2 lanes:**

| Lane | Branch @ tip | State | Merged into `ui-upgrade`? |
|---|---|---|---|
| Base (Phase 1) | `lane/ui-base` @ `9da891d` | **done** | yes |
| E states + perf, part 1 | `lane/ui-e-states` @ `6f73b45` | **part 1 done:** routes code-split, initial JS **216 kB gzip** (budget 300), mock fault modes, states spec | yes |
| D Evals | `lane/ui-d-evals` @ `5b16436` | **done** | yes |
| B Referral detail | `lane/ui-b-detail` @ `5d0a375` | **done** | yes |
| A Shell + Queue + RIS orders | `lane/ui-a-queue` @ `5fede76` | **~85%**, "wip: paused". Builds clean, lint 0 in its files; the RouteTransition first-load fix is done (`7d50e7f`) | no |
| C Pipeline graph (flow map) | `lane/ui-c-graph` @ `0c0150b` | **~85%**, "wip: paused". Builds clean, lint 0 in its files; e2e graph tests pass | no |

`ui-upgrade` holds base + E part 1 + D + B. The build has 0 errors. Token lint shows 7 violations, all in A's and C's folders, which those lanes have already fixed on their branches.

## Next steps when resuming (in order)
1. **Lane A** (`.worktrees/ui-a-queue`):
   - Finish perf: occasional 50–75 ms long tasks on queue → other pages during the crossfade. Status fades are now CSS and the per-row Morph mounts only on hover, focus or selection. The A/B test on the per-row Radix tooltip was invalid, because a port collided with Lane C, so redo it.
   - Do the final screenshot pass and the e2e run, then the report.
2. **Lane C** (`.worktrees/ui-c-graph`):
   - Re-shoot the final set with `$SCR/ui-c/final.sh`, plus one live-running shot uploading `referral_040`.
   - Re-run the `screens.spec` graph test, do the banned-tells review, then the report.
3. **Merge A, then C, into `ui-upgrade`**, checking ownership. Then:
   - lift `features/graph/labels.ts` into `lib/`, so Evals per-step timings use plain words;
   - delete `features/graph/DataTable.tsx` once nothing imports it.
4. **Lane E part 2:** the cross-screen states sweep (RIS down, no referrals, extraction pending, long names, 0 and 1 items). Include the Lane B toast that overlaps the fax pane.
5. **Phase 3 gate:**
   - `npm run build`, pytest (untouched), `npm run lint:tokens` = 0, `npm run check:bundle`;
   - on a fresh demo, Playwright `demo` → `screens` (screens needs the referral_013 upload from demo first), then `design` with `SHOTS_DIR=docs/design/after`, then `videos`, then `perf`;
   - write `docs/design/COMPARE.md` and the banned-tell and top-10 self-review;
   - push `ui-upgrade`;
   - write `docs/gates/UI-UPGRADE-GATE.md`, the CONTEXT block (≤40 lines) and the preview commands.

## Open change requests to settle at merge (orchestrator)
- **`CountThrough`:** accept `initial={false}` / `from` (A).
- **`DataTable`:** don't re-stagger rows after the first reveal (A).
- **`PageHeader`:**
  - a prop that lets the title wrap (D);
  - no clipping of Morph targets (A, B).
- **`BarComparison`:** an option for a plain value row (D).
- **`AccordionItem`:** an optional `action` slot (B).
- **`queueHref` and `useHotkeys`:** move them from `features/queue` to `lib/` (B imports them today).

## Notes
- **Lane branches are local only.** This run allows pushing only `ui-upgrade`. Their commits are safe in the local repo; push them only if Dhruv asks.
- **The shared demo database** (`.demo/` in `referral-intake/`) has a few lane test actions in it, e.g. referral_035 approved. The final gate uses a fresh demo anyway.
- **Agents:** the 5 lane agents are idle and resumable. On resume, new work for an existing lane goes to that lane's agent, so the run stays within its 5-agent cap.

## How to resume
```bash
cd ~/personal-projects/faxtract && git checkout ui-upgrade
claude "Resume the run in docs/UI-UPGRADE-RUN.md from docs/UI-UPGRADE-RESUME.md. Never touch main or v2-ui."
```

**Preview what's merged so far:**
```bash
cd ~/personal-projects/faxtract/referral-intake
make demo DEMO_ARGS="--api-port 8095 --web-port 5195"   # then open http://127.0.0.1:5195/queue
make demo-stop
```
