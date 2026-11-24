# UI audit: before the upgrade (v2-ui @ `9d89626`)

Screenshots are in `docs/design/before/` (`<nn>-<state>-<light|dark>.png`): 24 states in two themes. They were captured from the live demo, with the API intercepted for the loading, empty, error and RIS-down states. The spec is `web/e2e/design-shots.spec.ts`.

## Current tokens (`web/src/styles/globals.css`, `web/DESIGN.md`)
- **Colour.**
  - Neutrals: zinc (`#fff` / `#fafafa` / `#f4f4f5`); borders `#e4e4e7` / `#d4d4d8`; text `#18181b` / `#52525b` / `#a1a1aa`.
  - One accent: teal `#0f766e` (dark mode `#2dd4bf`).
  - Four status tones (ok, warn, bad, idle), each with fg/bg/border.
  - The neutrals are warm-ish zinc, not cool.
- **Type.** Inter 400/500/600 and JetBrains Mono. There are **6 sizes in use**: 11 (kbd), 12, 12.5 (mono), 13, 14, 16.
- **Shape.** Radius 6 px (plus a 4 px radius-sm); 1 px borders; one floating shadow.
- **Motion.** Effectively none. The only animation is the 1.2 s pulse ring on a running graph node. Routes, row → detail, status changes and panels all swap instantly.
- **Dark mode.** The tokens exist, but **nothing in the app ever applies `.dark`**: no toggle and no `prefers-color-scheme` hook. The `*-dark.png` screenshots were forced from the test harness.
- **Bundle.** The initial JS is **956 kB raw / 302 kB gzip** (`index-*.js`). pdf.js (645 kB) is already lazy-loaded. The routes are not code-split.

## Banned tells present

| Tell | Present? | Where |
|---|---|---|
| Cards inside cards / box soup | **yes** | Detail right column: a filled status banner, then a bordered field list, then bordered panels (`10-detail-needs-review`, `14-detail-sent-aa`). Evals: a bordered table next to a bordered run-facts block under a provenance block (`30-evals`). Graph node panel: bordered diff boxes inside a bordered panel (`23-graph-ris-error-node-panel`). |
| Icon-in-coloured-circle tiles | no | |
| Gradients, glass, glows, emoji, blobs | **borderline** | The graph's running node uses a teal **glow** pulse ring. |
| Default shadcn look left unstyled | **yes** | Stock Select triggers in the queue filters, a stock grey dialog overlay (`13-detail-reject-dialog`), stock tooltips. |
| Decorative icons everywhere | **partly** | Icons on every nav item and most buttons (upload, pencil, check, retry), plus the empty-state icon. |
| Rainbow badges | **yes** | 30 of 57 queue rows carry a filled amber "Needs review" pill (`01-queue`). Every orders row carries **two** filled green pills, status plus `AA` (`40-orders`). Confidence meters in every row. |
| Coloured left-border alert rows | **borderline** | The selected queue row gets a 2 px teal left bar (`02-queue-keyboard-selected`). Detail status uses **filled coloured alert boxes** (amber, green, red) in `10`, `14`, `15` and `16`. |
| Giant numbers with no context | no | The opposite problem: the key numbers have no hierarchy at all (`30-evals`). |
| Generic copy | **partly** | "Request failed (500)" (`06-queue-error`). "Extracted fields 19 fields". The graph header reads "pipeline graph · 1 run · 27 ms in nodes · $0.0134", which is engineer copy for a coordinator. |
| Animating everything on load | no | Nothing animates. |
| Bounce / overshoot | no | |
| UI transitions over 400 ms | **yes** | The 1.2 s looping pulse. |

## Keep
- **The information architecture:** five screens, the left nav, the routes and query params, every `data-testid`, and all the API wiring. The e2e demo and screens specs depend on these.
- **The queue table's mechanics:** a dense 32 px table, sticky header, sort, filters in the URL, `j`/`k`/Enter, and work-first default ordering.
- **The referral detail's mechanics:**
  - a react-pdf split view with field boxes, and field ↔ box linking;
  - inline edit with 422 errors mapped per field;
  - Reject requires a reason;
  - Compare v1 vs v2;
  - ORM and ACK shown verbatim.
- **The graph's data model:** built from `/graph/structure` and the trace (nothing hardcoded), with the per-node state diff and the run timeline.
- **Evals provenance** (source file plus run timestamp) and "every number read at runtime".
- **The token architecture** (CSS variables mapped through `@theme inline`), Inter + JetBrains Mono, mono only for codes, and tabular numbers.
- **The copy that already speaks to a coordinator,** e.g. "57 referrals · 30 need review · 3 RIS errors".

## Top 10 problems (ranked)
1. **There is no hierarchy, only boxes and pills.**
   - Six text sizes; every screen reads at one volume.
   - Structure comes from borders and filled banners instead of type and space.
   - Screens: `01`, `10`, `30`.
2. **Status colour has become wallpaper.**
   - An amber pill on 30 of 57 queue rows.
   - Two green pills per orders row.
   - Green, amber and red filled banners on the detail page.
   - Nothing stands out, so nothing gets attention.
   - Screens: `01`, `40`, `14`, `15`.
3. **Teal means everything.** The nav's active state, the PIPELINE badge, links, the graph path and the Upload/Approve buttons all use the accent, so "act on this" has no signal. Screen: `01` (header and nav).
4. **The Pipeline graph is a state-machine dump.**
   - Tiny vertical nodes float in a wide canvas.
   - All 20 edges and their label chips are drawn, and they tangle around `human_review`/`order`.
   - What matters (where it is, why it stopped, what's next) is secondary.
   - Screens: `20`–`23`.
5. **The referral detail is one long, undifferentiated scroll.**
   - 19 field rows, each with a meter, then 5 bordered sections, all expanded.
   - The human-review moment (why it paused → fix → approve → sent) is not one flow.
   - Screens: `10`, `14`.
6. **Evals has no headline.**
   - It opens with provenance, then a dense table whose mono implementation names wrap over three lines, then a run-facts dump.
   - The actual result ("v2 retrieves the right policy for 60 of 60, v1 for 57") is never said.
   - Screen: `30`.
7. **No motion language.** Route changes, row → detail, status changes, panel open and close, and the graph progressing all swap instantly. Nothing explains what changed.
8. **States are generic or technical.**
   - Queue error: "Request failed (500)" (`06`).
   - RIS down is only a 6 px red dot in the header (`07`).
   - There is no "extraction running" state on the detail page.
   - Toasts sit over the nav footer (`11`, `12`).
9. **Stock primitives, and dark mode can't be reached.**
   - The selects, dialog overlay and tooltips are stock shadcn.
   - The dark tokens exist but no user can turn them on.
   - The neutrals are warm zinc rather than cool.
10. **Too much JS up front.** The initial bundle is 956 kB raw / 302 kB gzip with no route splitting, against a budget of under 300 kB.

**Budget interpretation (logged):** "initial JS < 300 kB" is measured as the **gzip** size of every script loaded before first paint of `/queue`, and the raw size is reported too.
