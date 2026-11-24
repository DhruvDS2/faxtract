RUN NAME: faxtract-ui-upgrade (P1)
Follow docs/ORCHESTRATOR.md: one worktree per lane in ./.worktrees/<name>, file ownership, frozen contracts. Model: Opus, xhigh. Max 5 agents.
Save this prompt as docs/UI-UPGRADE-RUN.md.

══ BRANCH + SAFETY (hard) ══
Branch `ui-upgrade` cut from v2-ui. Never commit to, merge into, rebase, reset or push main or v2-ui. Pushing ui-upgrade is allowed (no force).
FRONTEND ONLY (referral-intake/web/): no backend, graph, eval or seed changes. app/contracts.py and the web types are frozen. Every number comes from the API at runtime.
Use make demo DEMO_ARGS="--api-port 8095 --web-port 5195" (Kindling may hold 8000/5173). Use the replay extractor; no keyed runs.

══ GOAL ══
Upgrade the current web/ design (keep the screens, data, flows and API) so it looks like a real clinical-ops product built by a careful team, not vibecoded. Viewer: Dime's founders/engineers (healthcare admin automation). Feel: clinical, precise, trustworthy, calm. It shares the motion language of Dhruv's Kindling project, with its own look: cool neutrals, not warm paper.

══ LOCKED REFERENCES (details.so; take MOTION/LAYOUT only, never colors, logos or text) ══
Verify each ID loads and save a preview frame to docs/design/refs/. If one is unusable for its slot, pick the closest alternative in the same category, log why in DESIGN.md, and continue.
- Tone + queue rows: OhMD rows (ohmd-9b7a85); Evals headline stats: OhMD stats (ohmd-caa5e6)
- Row hover feel: ONOERA card hover (onoera-7902cb), applied subtly to rows, plus Linear traveling highlight (linear-445982) for nav + rows
- Row quick action: Terminal Industries (terminal-industries-axkwha): one quiet button on hover/focus ("Review", "Retry send")
- Queue → referral detail: ONTO contextual transition (studio-onto-swzj3c): the clicked row grows into the detail view (320ms)
- Page transitions: V7 Labs crossfade (v7labs-9f6e6d); nav stays still
- Pipeline graph: Decimals steps (decimals-d10992): how steps reveal and light up in sequence along the path taken
- Per-referral trace timeline under the graph: Ario (ario-7de2db)
- Referral detail panels (eligibility, policy citations, auth packet, HL7/X12 preview): Calendly accordion (calendly-1f7d31)
- Loading: Paradigm progressive table fill (paradigmai-586452); extraction fields fill in field by field on first load
- Number change: Lassie count-through (lassie-192f2b)
- Evals layout: Stripe ruled stat row (stripe-11c89a) + Effortel labeled bars (effortel-davmwm) for v1 vs v2
- Not on details.so (spec it ourselves): fax split view. Clicking a field pans/zooms the fax to its bounding box with a soft 2px outline (320ms); hovering a box highlights its field. Structure from real document-review tools.

══ VIBECODED TELLS: BANNED ══
Cards inside cards / box soup; icon-in-colored-circle tiles; gradients, glassmorphism, glows, emoji, decorative blobs; default shadcn look left unstyled; decorative icons everywhere; rainbow badges; colored left-border alert rows; giant numbers with no context; generic copy ("Dashboard", "Overview", "Welcome back"); animating everything on load; bounce/overshoot; UI transitions over 400ms.

══ WHAT GOOD LOOKS LIKE ══
Hierarchy from type, not boxes: 1 display size, 2–3 text sizes. Hairline dividers and whitespace on a strict 8px grid. Dense, readable tables (sticky header, right-aligned numbers, keyboard j/k + enter). Teal accent ONLY for "act on this" (Approve, Review); status colors only for status. Monospace only for codes (CPT, ICD-10, NPI, member ID, HL7/X12). Every state designed: loading, empty, error (RIS down), long names, 0/1 items. Copy written for a clinic intake coordinator ("31 referrals need review", "RIS didn't acknowledge. Retry send"). Motion only to explain change.

══ PHASE −1: RECONCILE ══
Check ui-upgrade and the worktrees for an existing audit, refs, tokens or lanes; skip what's done.

══ PHASE 0: AUDIT + PLAN (orchestrator; no STOP) ══
1. Before-screenshots of every screen and state (light + dark) → docs/design/before/.
2. docs/design/AUDIT.md: current tokens, the banned tells present (with screenshot refs), what to KEEP, and the top 10 problems ranked.
3. docs/design/PROPOSAL.md: an ASCII wireframe per screen (Queue, Referral detail, Pipeline graph, Evals, RIS orders) with what changes and the motion on each, mapped to the locked references.
4. Print the top 10 problems + a one-line plan per screen, then continue.

══ PHASE 1: TOKENS + BASE (one lane; gate for all others) ══
Evolve web/DESIGN.md (don't throw it away):
- Color: cool neutral bg layers, text levels, hairline border, ONE accent (deep teal), status set (sent/approved, needs review, rejected, error, pending), AA contrast, light + dark.
- Type: Inter + JetBrains Mono (codes only), a fixed scale, tabular numerals.
- Space 8px scale; small radii.
- Motion: 120ms hover/press, 200ms state, 320ms panels/pages, 600ms one-time reveals. Enter cubic-bezier(0.2,0.8,0.2,1), exit cubic-bezier(0.4,0,1,1). No bounce. prefers-reduced-motion → fades only.
- Libraries: `motion` (motion.dev) for layout/shared-element transitions; keep TanStack, react-pdf, @xyflow/react, Radix.
- Base components with all states (default/hover/focus/disabled/loading/empty/error): shell + nav, table, status pill, confidence meter, accordion, split pane, code viewer (HL7/X12 segment highlighting), stat row, bar comparison, button, toast, skeleton, empty state.
- A /__styleguide route rendering everything. A token lint script: 0 raw hex/px/ms in components.

══ PHASE 2: LANES (parallel; import only from base) ══
LANE A shell + Queue + RIS orders: nav, page crossfade, the queue table (OhMD rows, hover, quick action, j/k), the row → detail ONTO transition, RIS orders with ACK status + "Retry send".
LANE B Referral detail: the split view with field ↔ box linking, inline edit with validation (error → corrected states), Calendly-style panels, and the human-review moment as one clear flow: paused banner → fix field → Approve → the panel shows the graph resuming → "Order sent · ACK AA".
LANE C Pipeline graph: Decimals-style sequential node reveal along the path taken; node states (done, running, paused at human_review, skipped, error); click a node → side panel with state diff, duration, cost, retries; Ario-style trace timeline beneath.
LANE D Evals: a headline sentence ("v2 retrieves the right policy for 60 of 60 referrals; v1 for 57"), Stripe stat row, Effortel v1-vs-v2 bars that grow once, the false-approval case explained, source file + run timestamp quiet but visible.
LANE E states + perf: loading/empty/error states across all screens (RIS down, no referrals, extraction pending); code-split routes (initial JS < 300 kB).

══ PHASE 3: QA + GATE ══
- npm run build 0 errors; pytest green (untouched); token lint 0; Playwright screens spec passes.
- After-screenshots light + dark → docs/design/after/; docs/design/COMPARE.md with before | after | reference per screen.
- Playwright videos → docs/design/videos/: the 90-second demo script, the human-review moment, the pipeline graph lighting up.
- Self-review: every banned tell and each top-10 problem marked FIXED / NOT FIXED with a screenshot.
- Perf: no long tasks during transitions; reduced motion verified.
- Push ui-upgrade. Write docs/gates/UI-UPGRADE-GATE.md + a "CONTEXT FOR CLAUDE" block (≤40 lines) + preview commands. STOP.

══ DECISION LOG (from Dhruv, during Phase −1) ══
- Pipeline graph style: CLEAN FLOW MAP (n8n-like), left-to-right. The taken path is bold teal; untaken branches (reject, edit loop, RIS retry, no-auth bypass) are faint side branches; click a step for its input/output diff, duration, cost and retries. Lane C applies the Decimals step-reveal motion to this flow map, along the path taken, with the Ario trace timeline beneath. Still data-driven: the structure comes from GET /graph/structure and the states from the trace. Nothing is hardcoded.
- Audience: both, plain language first. Steps read as plain words ("Check coverage (270/271)") with a result summary. A "Technical details" toggle shows node ids, state diffs, tokens and cost.
