# Referral Intake: design system

Referral Intake is a clinical operations tool, and coordinators spend hours in it. It should feel **clinical, precise, trustworthy and calm**: dense where the work is, quiet everywhere else.
- Think Linear or Retool, not a marketing site.
- The neutrals are cool slate, never warm paper.

This file is the source of truth. The tokens live in `src/styles/globals.css`, the only place a colour, size, radius, duration or easing is written; `src/lib/motion.ts` mirrors the motion values for TypeScript. You can see every token and component in every state at **`/__styleguide`**.

It is **frozen for the ui-upgrade run after Phase 1.** Phase 2 lanes import only from `components/`, `lib/` and `app/`. Changes go through the orchestrator as a change request.

## Principles
1. **Colour means status.** Cool neutrals carry all structure.
   - There is **one accent, deep teal, and it means "act on this"**. It appears only on primary buttons, the row quick action (`quiet`), focus rings, and the pipeline graph's taken path (Dhruv's logged exception).
   - Nav selection, links, tabs and badges are neutral.
   - Status colour sits on the status itself (a dot, or an error's text) and nowhere else.
2. **Hierarchy comes from type, not boxes.** Each page has one display size, normally a sentence that says what matters ("31 referrals need review"). Below it sit 2–3 text sizes, hairline dividers and whitespace on an 8 px grid. No cards inside cards.
3. **Density with air.**
   - Tables use 40 px rows on hairlines, a sticky header, and right-aligned tabular numbers.
   - The keyboard comes first: `j`/`k` plus Enter.
4. **Flat.**
   - Dividers are 1 px hairlines and radii are small (4 and 6).
   - Only floating layers (popover, menu, dialog, toast) get `--shadow-float`.
   - No gradients, glass or glows.
5. **Codes are monospace, and only codes.** CPT, ICD-10, NPI, member ID, MRN, order IDs and HL7 / X12 use `<Code>` or `<CodeViewer>` (JetBrains Mono 12/18).
6. **Motion explains change, and nothing else.**
   - Durations are 120 / 200 / 320 ms, with 600 ms once for a reveal. There is no bounce and nothing over 400 ms.
   - Under `prefers-reduced-motion` every animation is an opacity fade.
7. **Every state is designed:** loading, empty, error (API down, RIS down), long names, 0 items and 1 item. Copy is written for a clinic intake coordinator.
8. **Say what's true.**
   - Every number on screen comes from the API at runtime.
   - Mock mode shows "Mock data" in the top bar, and the shell always says "Synthetic data · no PHI".
   - The styleguide's static values are labelled **Sample**.

## Banned (vibecoded tells)
These are review failures, not preferences.
- Cards inside cards, or box soup. Use type, spacing and hairlines instead.
- Icon-in-coloured-circle tiles, or an icon decorating an empty or error state.
- Gradients, glassmorphism, glows (including a glowing "running" ring), emoji and decorative blobs.
- The default shadcn look left unstyled: a grey overlay, a stock select, a stock tooltip.
- Decorative icons everywhere: on nav items, or on every button. An icon must do a job, such as a toggle glyph or a sort arrow.
- Rainbow badges, or filled status pills in tables. In a table, status is a **dot plus a label**.
- Coloured left-border alert rows, and a coloured left bar on the selected row. Selection is a neutral fill.
- Filled alert banners in page headers. Use one quiet `<StatusLine>`.
- Giant numbers with no context. Every stat has its label, and a comparison where one exists.
- Generic copy ("Dashboard", "Overview", "Welcome back", "Request failed (500)").
- Animating everything on load, bounce or spring overshoot, UI transitions over 400 ms, and any loop other than the running breathe.

## What good looks like
- **Pages:** the page title is a sentence built from API numbers, then one meta line ("57 received today · 19 sent to RIS · 3 RIS errors").
- **Tables:** 40 px rows, hairlines, Patient in weight 500 with the DOB muted, and the CPT in mono with the study muted. Confidence is a plain number, amber only below the threshold. There is one status column with the ACK folded in ("Sent to RIS · AA").
- **Quick actions:** one quiet teal action per row, shown on hover, focus or selection ("Review", "Retry send").
- **Copy:** names the actor and the next step ("RIS didn't acknowledge. Retry send." / "Couldn't load referrals. The API isn't responding.").
- **Engineer detail:** stays available but quiet. It sits behind a "Technical details" toggle on the graph, or in faint mono under an error.

## Colour (`src/styles/globals.css`, exposed to Tailwind through `@theme inline`)
Tailwind's palette, type, radius and shadow scales are **cleared**, so only these tokens exist as utilities: `bg-surface`, `text-fg-muted`, `border-control` and so on.

**Neutrals.** Cool and slate-leaning.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#ffffff` | `#0e1116` | page, table body |
| `surface` | `#f7f8fa` | `#13171d` | sidebar, subtle hover, code blocks |
| `surface-2` | `#eef1f4` | `#1a1f26` | traveling hover highlight, skeleton |
| `raised` | `#ffffff` | `#191e25` | popover, menu, dialog, toast |
| `selected` | `#e6eaef` | `#232a33` | selected row, active nav item (neutral) |
| `border` | `#e3e7ec` | `#252b34` | every hairline |
| `border-strong` | `#c9d0d9` | `#3a434f` | secondary button edge |
| `control` | `#8a94a3` | `#636d7b` | input / select boundary (3:1) |
| `fg` | `#121820` | `#e6e9ee` | primary text |
| `fg-muted` | `#4b5563` | `#a7afbb` | labels, secondary text |
| `fg-faint` | `#5c6675` | `#8a93a1` | meta, placeholders (still AA) |
| `scrim` | slate at 28% | near-black at 60% | dialog overlay |

**Accent.** "Act on this" only.

| Token | Light | Dark | Use |
|---|---|---|---|
| `accent` | `#0b6e66` | `#3fae9f` | primary fill, quiet action text, graph taken path |
| `accent-hover` | `#095a54` | `#5cc2b4` | primary hover |
| `accent-fg` | `#ffffff` | `#03201c` | text on accent |
| `accent-subtle` | `#e7f3f1` | `#12282a` | quiet action hover |
| `accent-border` | `#9cccc5` | `#23605a` | quiet action hover edge |
| `focus` | `#0b6e66` | `#4fbcad` | 2 px focus ring, offset 2 |

**Status: the five-state set.** `rejected` is a terminal human decision, so it is muted. `bad` is an error that needs action. `idle` covers pending and processing.

| Token | Light | Dark | Means | Looks like |
|---|---|---|---|---|
| `ok` | `#15734a` | `#52bf88` | sent, approved, ACK AA | green dot, neutral label |
| `warn` | `#9a5600` | `#e0a640` | needs review, below threshold | amber dot, neutral label |
| `bad` | `#be2b2b` | `#f07a76` | RIS error, failed, AE/AR, validation, "RIS down" | red dot, **red label** |
| `rejected` | `#6a7383` | `#8c95a3` | rejected (terminal) | slate dot, muted label |
| `idle` | `#5b6574` | `#9aa3b0` | pending, processing | hollow ring, muted label; it breathes while running |

The status tokens also have `-bg` and `-border` tints (`ok-bg`, `warn-border` and so on). Use them only for an inline tint where a person must act now, such as a field with a 422 error. Never fill a status pill or a banner with them.

**Data.** `chart-1` is v1, lighter (`#8a94a3` / `#5f6977`). `chart-2` is v2, darker (`#3c4654` / `#b9c1cc`). `chart-track` is the bar track. The two shades are neutral on purpose: colour never encodes better or worse, and bars always carry their value as text plus a legend.

### Contrast (measured, not guessed)
These ratios are computed from `globals.css` by `node scripts/contrast.mjs` (`npm run check:contrast`, which exits 1 if a required pair fails). The styleguide re-measures them live in the current theme.
- **Requirements:** text needs 4.5:1; controls, focus, status dots and chart marks need 3:1 (WCAG 1.4.11).
- **Exempt (decorative):** hairlines and hover fills. They carry no required information.
- **The selected row fill is below 3:1.** The selection is also carried by `aria-selected` and by the row's quick action, which becomes visible on the selected row in accent text at 5:1 or better.

**Result: all 38 required pairs pass AA in light and dark.**

| Foreground | Background | Need | Light | Dark | Used for |
|---|---|---|---|---|---|
| `fg` | `bg` | 4.5:1 | 17.84 | 15.54 | body text |
| `fg` | `surface` | 4.5:1 | 16.79 | 14.77 | sidebar, table header |
| `fg` | `selected` | 4.5:1 | 14.76 | 11.90 | selected row, active nav |
| `fg` | `raised` | 4.5:1 | 17.84 | 13.76 | popover, dialog, toast |
| `fg-muted` | `bg` | 4.5:1 | 7.56 | 8.55 | secondary text, labels |
| `fg-muted` | `surface` | 4.5:1 | 7.11 | 8.13 | nav items, header labels |
| `fg-muted` | `surface-2` | 4.5:1 | 6.67 | 7.49 | hovered row / nav item |
| `fg-muted` | `selected` | 4.5:1 | 6.25 | 6.54 | selected row meta |
| `fg-faint` | `bg` | 4.5:1 | 5.81 | 6.10 | meta, placeholders |
| `fg-faint` | `surface` | 4.5:1 | 5.47 | 5.80 | sidebar footer, header meta |
| `fg-faint` | `surface-2` | 4.5:1 | 5.13 | 5.34 | meta on a hovered row |
| `fg-faint` | `selected` | 4.5:1 | 4.81 | 4.67 | meta on a selected row |
| `accent-fg` | `accent` | 4.5:1 | 6.11 | 6.33 | primary button |
| `accent-fg` | `accent-hover` | 4.5:1 | 8.07 | 8.01 | primary button, hover |
| `accent` | `bg` | 4.5:1 | 6.11 | 6.99 | quiet row action, links |
| `accent` | `surface-2` | 4.5:1 | 5.39 | 6.13 | quiet row action on a hovered row |
| `accent` | `selected` | 4.5:1 | 5.06 | 5.35 | quiet row action on a selected row |
| `accent` | `accent-subtle` | 4.5:1 | 5.38 | 5.70 | quiet action, hover |
| `ok` | `bg` | 4.5:1 | 5.86 | 8.25 | status label / dot (sent, approved) |
| `warn` | `bg` | 4.5:1 | 5.67 | 8.73 | status label / dot (needs review) |
| `bad` | `bg` | 4.5:1 | 5.88 | 6.98 | status label (error, RIS down) |
| `bad` | `surface` | 4.5:1 | 5.54 | 6.64 | RIS down in the top bar |
| `bad` | `selected` | 4.5:1 | 4.87 | 5.34 | error label on a selected row |
| `rejected` | `bg` | 4.5:1 | 4.78 | 6.25 | rejected (muted, terminal) |
| `idle` | `bg` | 4.5:1 | 5.90 | 7.42 | pending / processing |
| `ok` | `ok-bg` | 4.5:1 | 5.35 | 7.09 | inline success tint |
| `warn` | `warn-bg` | 4.5:1 | 5.23 | 7.67 | inline review tint |
| `bad` | `bad-bg` | 4.5:1 | 5.32 | 6.41 | inline validation error |
| `focus` | `bg` | 3:1 | 6.11 | 8.22 | focus ring |
| `focus` | `surface` | 3:1 | 5.75 | 7.82 | focus ring in the sidebar |
| `control` | `bg` | 3:1 | 3.07 | 3.61 | input / select / checkbox boundary |
| `ok` | `surface-2` | 3:1 | 5.17 | 7.23 | status dot on a hovered row |
| `warn` | `surface-2` | 3:1 | 5.00 | 7.65 | status dot on a hovered row |
| `bad` | `surface-2` | 3:1 | 5.19 | 6.11 | status dot on a hovered row |
| `rejected` | `surface-2` | 3:1 | 4.22 | 5.48 | status dot on a hovered row |
| `idle` | `surface-2` | 3:1 | 5.21 | 6.50 | pending ring on a hovered row |
| `chart-1` | `bg` | 3:1 | 3.07 | 3.40 | v1 bar |
| `chart-2` | `bg` | 3:1 | 9.56 | 10.41 | v2 bar |
| `chart-1` | `chart-2` | — | 3.12 | 3.06 | v1 vs v2 bars (also labelled) |
| `border` | `bg` | — | 1.24 | 1.33 | hairline divider (decorative) |
| `border-strong` | `bg` | — | 1.55 | 1.89 | secondary button edge (text-identified) |
| `selected` | `bg` | — | 1.21 | 1.31 | selected row fill (+ aria-selected) |
| `surface-2` | `bg` | — | 1.13 | 1.14 | hover fill |

## Type
Inter is the UI face (400 / 500 / 600). JetBrains Mono is for **codes only**. Both are bundled from npm (`@fontsource/*`), with no CDN. Numeric contexts use `tabular-nums`.

| Utility | Size / line | Weight | Use |
|---|---|---|---|
| `text-display` | 22 / 28, −0.011em | 600 | the one page line (a sentence) |
| `text-title` | 15 / 22 | 600 | section titles |
| `text-body` | 13 / 20 | 400 / 500 | everything else |
| `text-meta` | 12 / 16 | 400 / 500 | meta lines, table headers, labels |
| `text-code` | 12 / 18 (mono) | 400 / 500 | CPT, ICD-10, NPI, member ID, MRN, order IDs, HL7 / X12 |

The legacy `text-xs` / `sm` / `base` / `lg` utilities map onto this scale (12, 13, 15, 15), so the v2-ui screens already sit on it.

`cn()` knows these are font sizes (`lib/utils.ts` extends tailwind-merge). Don't bypass `cn()` when you combine a size with a colour.

## Space, shape, elevation
- **Space.** An 8 px grid built on Tailwind's spacing (`2` = 8, `4` = 16, `6` = 24, `8` = 32). `1` (4 px) is allowed only as a half step inside dense controls. Pages pad 24 px horizontally (`px-6`).
- **Radius.** `rounded-sm` is 4 (glyph-size marks, kbd, menu items). `rounded-md` is 6 (buttons, inputs, layers). `rounded-full` is for status dots only.
- **Lines and shadow.** Hairlines are `border-border`. `shadow-float` is for floating layers only.
- **Layout tokens:**
  - shell: `--shell-nav-w` (224), `--shell-bar-h` (40);
  - `--kv-label` (136), `--toast-offset-bottom` (80, clears a sticky actions bar);
  - layer widths: `--dialog-w`, `--popover-w`, `--menu-min-w`, `--tooltip-max-w`;
  - `--code-max-h`.

## Motion
| Token | CSS | TS (`lib/motion.ts`) | Use |
|---|---|---|---|
| `--dur-fast` | 120 ms | `DURATION.fast` | hover, press, exit |
| `--dur-state` | 200 ms | `DURATION.state` | state change |
| `--dur-panel` | 320 ms | `DURATION.panel` | panels, pages, shared element |
| `--dur-reveal` | 600 ms | `DURATION.reveal` | one-time reveals (count-through, bars) |
| `--dur-breathe` | 1800 ms | `DURATION_MS.breathe` | the only loop: "running" (opacity) |

- **Easing.** Enter `cubic-bezier(0.2,0.8,0.2,1)` (`ease-enter`, `EASE.enter`); exit `cubic-bezier(0.4,0,1,1)` (`ease-exit`, `EASE.exit`). No springs, no bounce, no overshoot.
- **Utilities:**
  - durations: `duration-fast` / `-state` / `-panel` / `-reveal`;
  - loops and reveals: `animate-breathe`, `animate-fade-in`;
  - progressive fill: `animate-row-in` / `animate-field-in` (set `--i` for the stagger: 40 / 30 ms, capped);
  - floating layers: `animate-pop-in` / `-out`, `animate-dialog-in` / `-out`.
- **Reduced motion.**
  - Every CSS transform distance is a `--motion-*` variable that becomes 0, and staggers become 0.
  - `<MotionConfig reducedMotion="user">` turns transforms and layout animation off, `useMotionPrefs()` returns opacity-only variants, and `<Morph>` drops its `layoutId`.
  - The result is **fades only**.
- **Motion runs lazily.** `<LazyMotion strict>` loads the animation features after first paint. Always use `m` from `@/lib/motion`, never `motion.*` or `framer-motion`; the token lint enforces this.
- **Transition window.** While any route crossfade, shared-element morph, accordion or count-through runs, `<html>` carries `data-transitioning="true"` (`beginTransition()` / `useTransitionMarker()`). QA measures long tasks inside these windows.

**`lib/motion.ts` exports:**
- constants: `DURATION`, `DURATION_MS`, `STAGGER`, `EASE`, `OFFSET`, `FEEDBACK_MS`, `transition.{fast,state,panel,reveal,exit,exitPanel}`;
- variants: `fade`, `crossfade`, `panelSlide(side)`, `listStagger(step)` + `listItem`, `revealOnce`, `breathe`, `fadeOnly(v)`;
- hooks: `useMotionPrefs()` → `{ reduce, fade, crossfade, panelSlide, listStagger, listItem, revealOnce, safe, transition }`;
- shared element: `referralLayoutId(id)`;
- transition window: `beginTransition()`, `useTransitionMarker()`;
- re-exports: `m`, `AnimatePresence`, `LayoutGroup`, `useInView`, `useIsPresent`.

**Route transition (V7).** `app/RouteTransition.tsx` wraps the outlet, keyed by pathname, so query-string changes don't crossfade.
- The outgoing page fades out over 120 ms, then the incoming page fades in over 200 ms. The nav never moves.
- The outgoing page keeps the location it was rendered with, so its hooks never see the next route.
- Each page container is `data-testid="route-transition"` (`absolute inset-0 overflow-auto`): a page scrolls inside it.

**Shared element: queue row → referral detail (ONTO, 320 ms).** Lanes A and B only wrap their elements:
```tsx
import { Morph } from "@/components/Morph";
import { referralLayoutId } from "@/lib/motion";
// Lane A, in the queue row's Patient cell
<Morph as="span" layoutId={referralLayoutId(r.id)} className="truncate font-medium">{r.patient_name}</Morph>
// Lane B, the detail header title
<PageHeader title={<Morph as="span" layoutId={referralLayoutId(id)}>{name}</Morph>} … />
```
- **How it runs.** When the detail page mounts a `[data-morph]` that the leaving queue page also has, `RouteTransition` shows the incoming page at once (`data-route-morph`). The name then grows from the row into the header, and the rest of the page fades in after the queue has left.
- **The target must render in the first commit.** Lane B renders the header from the cached queue row (`queryClient.getQueryData(keys.referrals())`) while the full record loads.
- **If routes are code-split,** preload the detail chunk from the queue (on mount or row hover). A target that mounts after the queue has gone just crossfades.
- **Re-renders never re-measure,** so sorting or filtering the queue doesn't animate names. Don't pass the same `layoutDependency` to source and target.
- The styleguide proves it in-page and across routes (`/__styleguide#morph`).

## Theme
- **Storage.** `localStorage.theme` is `"light"`, `"dark"` or `"system"`; the default is `"system"`, which follows `prefers-color-scheme` live.
- **What gets applied.** The resolved theme goes on `<html>` as the `.dark` class plus `data-theme="light|dark"`. It is applied when `lib/theme.ts` loads (before the first render) and kept in sync across tabs.
- **Where to change it.** `<ThemeToggle>` in the top bar (light / dark / system), or `useTheme()` → `{ pref, theme, setPref }`.
- `e2e/design-shots.spec.ts` relies on exactly this mechanism.

## Status vocabulary (`src/lib/status.ts`)
| `ReferralStatus` | Label | `statusTone()` | Notes |
|---|---|---|---|
| `processing` | Processing | idle | dot breathes |
| `needs_review` | Needs review | warn | |
| `auto_approved` | Auto-approved | ok | breathes while sending |
| `approved` | Approved | ok | breathes while sending |
| `sent_to_ris` | Sent to RIS | ok | `statusText()` folds the ACK: "Sent to RIS · AA" (AE/AR → bad) |
| `ris_error` | RIS error | bad | "RIS error · no ACK" / "RIS rejected · AE" |
| `rejected` | Rejected | rejected | muted terminal state |
| `failed` | Failed | bad | |

`STATUS[s].tone` keeps the v2-ui four-tone value for old callers. New code uses `statusTone()`, `statusText()` and `isRunning()`.

**Confidence.** A two-decimal number, neutral at or above the threshold, amber below it, red below 0.5. The threshold comes from `GET /health`; never hardcode 0.85. Use `<ConfidenceMeter quiet>` to fade values at or above the threshold.

## Pipeline graph (decision log, Dhruv)
- **Layout.** A clean left-to-right flow map (n8n-like):
  - the taken path is bold teal (the logged accent exception);
  - untaken branches (reject, the edit loop, RIS retry, the no-auth bypass) are faint 1 px side branches.
- **Click a step** for its input / output diff, duration, cost and retries.
- **Reveal.** Lane C applies the Decimals step reveal along the path taken, with the Ario trace timeline beneath.
- **Data-driven.** The structure comes from `GET /graph/structure` and the states from the trace; nothing is hardcoded.
- **Plain language first.** Steps read as plain words ("Check coverage (270/271)") with a result summary. A **Technical details** toggle shows node ids, state diffs, tokens and cost.
- **Node states:**
  - done: neutral with ✓;
  - running: teal outline breathing (opacity only, no glow);
  - paused at human review: amber;
  - skipped: dashed and faint;
  - error: red.

## Components
**Primitives** (`src/components/ui/`, Radix + `cva`, restyled, APIs unchanged):

| Primitive | Notes |
|---|---|
| `Button` | `variant`: `primary` (teal, one per view), `secondary`, `ghost`, `danger`, `quiet` (teal text, for the row quick action). `size`: `sm` 28 / `md` 32 / `icon`. Props: `loading`, `loadingText`, `asChild`. |
| `Badge` | Neutral; a `tone` adds a dot. `accent` renders neutral. |
| Form controls | `Input` and `Textarea` have a 3:1 `control` edge, accent focus, and turn red with `aria-invalid`. `Label`. |
| `Select*` | Raised menu with a neutral check. |
| `DropdownMenu*` | Adds `DropdownMenuLabel`. |
| `Popover*`, `Dialog*` | The dialog sits on a slate scrim and is raised. |
| `Tooltip` / `Tip` | Inverted, small. |
| `Tabs*` | Neutral fg underline. |
| `Table*` | 40 px rows, hairlines on cells, sticky header, neutral selected fill. |
| Others | `Kbd`, `Skeleton` (breathes), `ScrollArea`, `Separator`, `Toaster` / `toast` (sonner: status dot, neutral text, above the actions bar, never over the nav). |

**App components** (`src/components/`):

| Component | Props |
|---|---|
| `DataTable` / `DataTableView` / `useDataTable` | `data`, `columns`, `getRowId`; sorting (`sorting`, `initialSorting`, `enableMultiSort`); `columnFilters`, `globalFilter`, `meta`; `loading` (progressive fill), `error` + `onRetry` + `errorTitle`, `empty`; `selectedId` + `onSelectedChange` + `keyboard` (j/k/Enter), `onOpen`, `quickAction(row)`; `rowTestId`, `rowProps`, `highlight` (traveling), `reveal`. Column meta: `numeric`, `truncate`, `align`, `className`, `headClassName`, `skeleton`. |
| `StatusPill` / `StatusDot` | `tone` (ok, warn, bad, rejected, idle), `running`, `detail` |
| `StatusBadge` | `status` |
| `ReferralStatusPill` | `status`, `ack` |
| `AckBadge` | `code` |
| `StatusLine` | `tone`, `children` (the sentence), `detail`, `action`, `running`: one quiet header line |
| `ConfidenceMeter` | `value`, `threshold?`, `bar?`, `quiet?`. `Confidence` keeps the v2 API. |
| `Accordion` | `value` / `defaultValue` / `onValueChange`; one open at a time. |
| `AccordionItem` | `value`, `title`, `summary` (right side), `disabled`. 320 ms height and opacity. |
| `SplitPane` | `left`, `right`, `defaultPct`, `min`, `max`, `storageKey`, `label`; drag, arrow keys, double-click to reset. |
| `CodeViewer` | `code`, `format` (hl7, x12, text, auto), `lineNumbers` (off by default), `copy`, `label`, `wrap`, `capHeight`. `Code`, plus `CodeBlock({ lines })` kept from v2. |
| `StatRow` | `stats: { id, value, label, comparison? }[]`, on hairline rules |
| `CountThrough` | `value`, `format`: 600 ms once in view, 200 ms through changes, final value under reduced motion |
| `BarComparison` | `series`, `rows: { id, label, values, display?, max? }[]`, `format`, `caption`: two neutral shades, grows once |
| `PageHeader` | `title` (display), `meta`, `status`, `actions`, `eyebrow`, `divider` |
| `KeyValue` | `label`, `children` |
| `EmptyState` | `title`, `hint`, `action`, `align` |
| `ErrorState` | `error`, `onRetry`, `title`, `align`. A plain-language cause plus faint technical detail; `describeError()` is exported. |
| `LoadingRows` | `rows` |
| `Morph` | `layoutId`, `as` (div, span, h1, h2, h3, p), `layoutDependency?`: the shared element |
| `TravelingHighlight` + `useTravelingHighlight()` | one hover highlight that glides between items |
| `ThemeToggle` | `withLabels?` |

**Shell** (`src/app/`):
- **Nav.** Text-first: Queue, Pipeline, Evals, RIS orders. Counts sit on the right (needs review from `useReferrals`, RIS errors from `useOrders`). The active item is a neutral fill, with a traveling hover highlight.
- **Top bar:**
  - the PIPELINE in quiet mono (`data-testid="pipeline-badge"`);
  - health as words (`health-ris`, `health-db`), with "RIS down" in red;
  - "The API isn't responding" when `/health` fails;
  - the theme toggle.
- **`RouteTransition`** wraps the outlet.

## Token lint (`npm run lint:tokens`)
`scripts/lint-tokens.mjs` scans `src/components`, `src/features` and `src/app`, and reports per file. It fails on:
- raw colours: hex, colour functions, and Tailwind palette classes such as `bg-zinc-100` or `text-white`;
- raw sizes: `NNpx`, including arbitrary values like `text-[13px]` and `w-[140px]`;
- raw durations: `NNms`, `duration-150`, `duration-[250ms]`;
- raw easings: `cubic-bezier(` and `ease: [..]`;
- bare numbers for lengths in `style={{…}}`;
- bare numbers for x / y / duration / delay in motion configs or variants;
- `motion` / `framer-motion` imports.

Only `styles/globals.css`, `lib/motion.ts` and `*tokens*` files may hold raw values. Use `--scope=base` (components, app, styleguide) or `--scope=features`, and `--summary` for counts only.

The escape hatch is narrow and needs a reason. Use it only where a token can't express the value, such as react-pdf canvas sizing or React Flow internals:
```tsx
const page = 612; // tokens-allow: react-pdf renders the page at a pixel width
// tokens-allow-next-line: React Flow needs numeric node sizes
{/* tokens-allow-next-line: <reason> */}   // in JSX
```

## Layout
- **Shell.**
  - The sidebar (224 px, `surface`) holds the product name, the nav and the "Synthetic data · no PHI" footer.
  - The 40 px top bar holds pipeline, health and theme. The page title lives on the page, not the bar.
- **Referral detail.** A resizable split, defaulting to 50/50:
  - left: the fax, via react-pdf with box overlays;
  - right: the fields and the Calendly-style panels, with a sticky actions bar. Toasts clear that bar.
- **Keyboard.**
  - Queue: `j`/`k` to move, `Enter` to open (`useHotkeys` in `lib/hotkeys.ts`; `DataTable keyboard`).
  - Detail: `e` to edit, `a` to approve, `r` to reject, `Esc` to cancel or go back.
  - Show hints with `<Kbd>`.

## Copy
- Sentence case, short, no exclamation marks. Write for the intake coordinator first; engineer detail comes second and stays quiet.
- Name the actor and the next step: "Graph paused at human review", "RIS rejected the order (AE): missing PID", "RIS didn't acknowledge. Retry send."
- **Errors** say what didn't load, then why in plain words, then the technical detail faint: "Couldn't load referrals · The API isn't responding · HTTP 500 · database is unavailable".
- **Dates:** relative in the queue ("12m ago", with an absolute tooltip); `2026-11-23 14:05` on detail screens.

## References (details.so; motion and layout only, never colours, logos or text)
Verified in `docs/design/refs/README.md`.

| Slot | Reference | Used for |
|---|---|---|
| Tone + queue rows | OhMD rows `ohmd-9b7a85` | calm rows on hairlines |
| Row hover | ONOERA `onoera-7902cb` | subtle hover reveal timing (not the card lift) |
| Traveling highlight | Linear `linear-445982` | nav + table rows |
| Row quick action | Terminal Industries `terminal-industries-axkwha` | one quiet right-aligned action |
| Queue → detail | ONTO `studio-onto-swzj3c` | the shared-element morph |
| Page transitions | V7 Labs `v7labs-9f6e6d` | crossfade, nav still |
| Graph reveal | Decimals `decimals-d10992` | steps light up in sequence along the taken path |
| Trace timeline | Ario `ario-7de2db` | time axis layout only |
| Detail panels | Calendly `calendly-1f7d31` | one-open accordion |
| Loading | Paradigm `paradigmai-586452` | progressive table fill |
| Number change | Lassie `lassie-192f2b` | count-through |
| Evals stats | Stripe `stripe-11c89a` | ruled stat row |
| v1 vs v2 bars | Effortel `effortel-davmwm` | labelled bars |

**Substitutions and caveats (logged):**
- **`ohmd-caa5e6` (OhMD stats) is unusable.** It publishes no preview, and the details.so MCP was out of credits, so it couldn't be verified. It is replaced by **`stripe-11c89a`** (same *stats* category; a ruled row of labelled stats), keeping the OhMD tone from `ohmd-9b7a85`.
- **Paradigm** is catalogued as a nav dropdown, but its frame is a dense results table. We take only the progressive table fill.
- **Effortel is partial.** Its frame shows labelled metrics but no clear bars, so the labelled-bar layout is specified by us: label left, value right, a bar that grows once over 600 ms.
- **The fax split view isn't on details.so.** We specify it from document-review tools (DocuSign, Rossum, Hyperscience): a field click pans and zooms to its box with a 2 px outline (320 ms), and box hover ↔ field.
- **Motion comes from the tokens above plus each reference's catalogued interaction.** No frame-by-frame study was possible (MCP credit limit).
