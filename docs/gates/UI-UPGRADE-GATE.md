# UI-upgrade gate: faxtract-ui-upgrade (P1)

- **Run:** 2026-11-23 → 24, with one pause (`docs/UI-UPGRADE-RESUME.md`).
- **Prompt and decision log:** `docs/UI-UPGRADE-RUN.md`.
- **Design docs:** `docs/design/` (AUDIT, PROPOSAL, COMPARE, refs/, before/, after/, videos/).

## Verdict
**PASS.** All five screens are rebuilt on a new design system: cool neutrals, teal only for "act on this", one display size, hairlines, and a motion language. The pipeline graph is now the left-to-right flow map Dhruv chose.

- Every gate below is green, run on a freshly seeded demo.
- The change set is frontend-only: nothing outside `referral-intake/web/` differs from v2-ui except docs.
- There are no keyed runs; extraction is the replay engine.

## Branch safety

| Branch | Before the run | After the run |
|---|---|---|
| `main` | `aecf845` | `aecf845` (local and origin) |
| `v2-ui` | `9d89626` | `9d89626` (local and origin) |

Only `ui-upgrade` was pushed, with no force. The lane branches `lane/ui-*` are local only.

## Gates

| Gate | Result |
|---|---|
| `npm run build` | **0 TypeScript errors** |
| pytest (backend untouched) | **189 passed**, 0 failed |
| `npm run lint:tokens` (no raw hex/px/ms in components) | **0 violations** (43 base + 52 feature files) |
| `npm run check:bundle`, initial JS for `/queue` before first paint | **240.2 kB gzip** (budget < 300) · 739.5 kB raw. Before: 297.6 kB gzip / 956 kB raw. "300 kB" is read as gzip, logged in AUDIT; raw is still above 300 kB |
| Playwright `demo` (the 90-second script) | **pass** → `docs/design/videos/demo-90s.webm` (47 s) |
| Playwright `screens` (frozen test ids and flows) | **5/5** → `docs/design/after/gate/` |
| Playwright `design` (after-shots, 24 states × light/dark) | **16/16** → `docs/design/after/` (48 shots) |
| Playwright `videos` | **2/2** → `human-review.webm` (25 s), `graph-lights-up.webm` (17 s) |
| Playwright `states` (mock fault modes × screens × themes) | **16/16** → `docs/design/after/states/` (82 shots) |
| Playwright `perf` on the production build (`vite preview`) | **3/3 runs:** no long tasks inside transition windows, and reduced motion is fades only (zero transforms). Load average 7.7–9 |

**Perf, honestly:**
- **Under heavy machine load** (load 13–33, from iCloud sync, desktop Chrome and parallel lanes), Lane E measured 8 of 10 runs passing. The 2 failures were single 56–57 ms tasks, and traces show they were mostly CPU wait.
- **Base comparison:** base `ui-upgrade` fails that same step at the same rate (Lane A's side-by-side).
- **Fixed during the run:**
  - a style-recalc cost from `:has()` selectors in the morph CSS;
  - per-row Radix tooltips and `/health` subscriptions;
  - row re-renders when the progressive fill finishes.

## Self-review: banned tells (all screenshots in `docs/design/after/`)

| Tell | Status | Evidence |
|---|---|---|
| Cards inside cards / box soup | **FIXED** | Sections are type plus hairlines. The detail's filled banners are gone (`10`, `14`). Evals has no nested blocks (`31-evals-full`). The only floating layer is the graph side panel and dialogs (`23`, `13`) |
| Icon-in-coloured-circle tiles | **FIXED** (none before, none after) | Empty states are text only (`05`, `41`, `32`) |
| Gradients, glass, glows, emoji, blobs | **FIXED** | The running node's glow ring became an opacity breathe (`videos/graph-lights-up.webm`) |
| Default shadcn look left unstyled | **FIXED** | The primitives are restyled through tokens (`/__styleguide`). The dialog scrim is a token (`--scrim`, 28% slate) with a fade (`13-detail-reject-dialog`) |
| Decorative icons everywhere | **FIXED** | The nav is text with counts. Icons stay only where they work: fax toolbar, sort, theme toggle (`01`, `10`) |
| Rainbow badges | **FIXED** | Status is a dot plus text with the ACK folded in (`01`, `40`). No filled pills |
| Coloured left-border alert rows | **FIXED** | Neutral selected row (`02`). Status lines instead of filled alerts (`10`, `15`) |
| Giant numbers with no context | **FIXED** | Each evals stat has a label and its v1 comparison (`30`) |
| Generic copy | **FIXED** | Coordinator sentences: "31 referrals need review", "3 orders weren't acknowledged by the RIS", "Couldn't load referrals. The API isn't responding." (`01`, `40`, `06`) |
| Animating everything on load | **FIXED** | Only one-time reveals tied to data: queue fill, field fill, graph path, stats and bars. Nothing replays on refetch (`videos/`) |
| Bounce / overshoot | **FIXED** | Tween easings only, enter `cubic-bezier(0.2,0.8,0.2,1)` and exit `cubic-bezier(0.4,0,1,1)` (`lib/motion.ts`) |
| UI transitions over 400 ms | **FIXED** | Hover is 120 ms, state 200 ms, panels and pages 320 ms. 600 ms is used only for one-time reveals (count-through, bars, graph path), which the run's motion spec allows |

## Self-review: top 10 problems from `AUDIT.md`

| # | Problem | Status | Evidence |
|---|---|---|---|
| 1 | No hierarchy; boxes and pills | **FIXED** | One display sentence per page; 15/13/12 text and mono 12 (`01`, `10`, `30`) |
| 2 | Status colour as wallpaper | **FIXED** | Dots plus text; the only fills left are on the human-review node and the 422 field (`01`, `40`, `21`, `11`) |
| 3 | Teal means everything | **FIXED** | Teal stays on Approve, Upload fax, Fix & resume, Retry send, the quick action, focus and the graph's taken path (Dhruv's exception). The nav is neutral (`01`, `21`) |
| 4 | The graph is a state-machine dump | **FIXED** | The left-to-right flow map with plain steps and results (`21`, `22`, `23`) |
| 5 | The detail page is one long scroll | **FIXED** | Why it stopped → grouped fields → accordion panels (`10`, `14`) |
| 6 | Evals has no headline | **FIXED** | The API-built headline sentence (`30`) |
| 7 | No motion language | **FIXED** | Crossfade, morph, fills, count-through, bars, the fax camera, step reveal (`videos/*.webm`) |
| 8 | States are technical | **FIXED** | Plain copy with the technical detail faint. RIS down and API down appear in words. "Reading the fax…" for pending (`06`, `07`, `states/`) |
| 9 | Stock primitives; dark mode unreachable | **FIXED** | Restyled primitives; light/dark/system toggle; every screen in dark (`*-dark.png`) |
| 10 | 956 kB / 302 kB of initial JS | **FIXED** (gzip) | 240.2 kB gzip. Raw is 739.5 kB: under budget as gzip, not as raw |

## References
- **All 14 IDs load,** and their frames are saved in `docs/design/refs/`.
- **The details.so MCP was out of credits,** so references were verified from their public pages and single preview frames. Motion therefore follows the run's motion tokens plus each reference's catalogued interaction.
- **Substitution:** `ohmd-caa5e6` (no preview published) was replaced by `stripe-11c89a` (same stats category).
- **Caveats, logged in `refs/README.md` and `web/DESIGN.md`:** Paradigm was used for its table only; Effortel was partial.

## Lanes (all merged into `ui-upgrade`, `--no-ff`)

| Lane | Delivered |
|---|---|
| Base (Phase 1) | DESIGN.md tokens (AA contrast verified by script, light and dark), motion tokens and `LazyMotion`, base components, shell, theme, `/__styleguide`, the token lint |
| A: shell + Queue + RIS orders | Sentence headers, status tabs, quick actions, progressive fill, the row → detail morph, the RouteTransition first-load fix |
| B: Referral detail | Why it stopped, grouped fields, the fax camera, the accordion panels, the human-review flow |
| C: Pipeline graph | The flow map, its layout algorithm (structure-driven), plain labels, step reveal, side panel with Technical details, trace timeline |
| D: Evals | The headline sentence logic (14 cases), stat row, bars, false-approval prose, provenance |
| E: states + perf | Route code-splitting, vendor chunks, the bundle check, mock fault modes, the states spec, base change requests, the cross-screen states sweep, perf fixes |
| Orchestrator | Phase 0 audit and plan; the e2e design/videos/perf specs; the pre-paint theme script; the fax loading placeholder (cold first open was an empty pane) |

## Known limits
- **Escape back from the detail view:** the morphing name enters its queue row from under the tab bar, because the queue table scrolls inside its own container. Fixing it means making the queue page scroll as one container.
- **Raw initial JS** is 739.5 kB. It is under budget only by the gzip interpretation.
- **Perf can flake under heavy machine load,** as described in the perf note above.
- **The detail page's compare panel** shows its skeleton for about 1–2 s on the first call, while the embedding model warms up (`12-detail-compare`).

## Preview it locally
```bash
cd ~/personal-projects/faxtract && git fetch origin && git checkout ui-upgrade && git pull --ff-only origin ui-upgrade
cd referral-intake
make demo DEMO_ARGS="--api-port 8095 --web-port 5195"     # then open http://127.0.0.1:5195/queue
#   try: upload corpus/out/referral_013.pdf → watch the graph → Fix & resume → First name "Clara" → Approve → Evals
#   design system: http://127.0.0.1:5195/__styleguide   ·   theme toggle top-right
make demo-stop
```
