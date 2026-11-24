# Referral Intake: design system

A clinical operations tool. Coordinators spend hours in it, so it should be dense, calm and trustworthy. Think Linear or Retool, not a marketing site. Every UI lane follows this file. The tokens live in `src/styles/globals.css`, and that file is the only place a colour, radius or font is defined.

This file is **frozen for the v2-ui run**. Ask the orchestrator before changing it.

## Principles
1. **Colour means status.** The neutral gray scale carries all structure. There is one accent, deep teal, for interaction: primary buttons, the active nav item, focus, links, the selected row and the path a referral took through the graph. Green, amber, red and gray appear only where they say something about a referral's status.
2. **Density with air.** Body text is 13 px, table rows are 32 px, everything sits on a 4 px grid, and panels use 12–16 px padding. Hierarchy comes from weight and spacing, not from boxes inside boxes.
3. **Flat.** Borders are 1 px, radius is 6 px, there are no gradients, and nothing on the page has a shadow. Only floating layers (popover, dropdown, dialog, toast) get the single soft `--shadow-float`.
4. **Codes are monospace.** CPT, ICD-10, NPI, member ID, group ID, MRN, order IDs and HL7 / X12 text always use the `<Code>` component (JetBrains Mono, 12.5 px).
5. **Say what's true.** Every number on screen comes from the API at runtime. Mock mode shows a persistent "MOCK DATA" chip. The shell always shows "Synthetic data · no PHI".

## Tokens (`src/styles/globals.css`, exposed to Tailwind via `@theme`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#0c0c0e` | page |
| `--surface` | `#fafafa` | `#121215` | sidebar, panel headers, table header |
| `--surface-2` | `#f4f4f5` | `#1a1a1e` | hover row, inputs (readonly), code blocks |
| `--border` | `#e4e4e7` | `#27272a` | every 1 px line |
| `--border-strong` | `#d4d4d8` | `#3f3f46` | inputs, focused containers |
| `--fg` | `#18181b` | `#f4f4f5` | primary text |
| `--fg-muted` | `#52525b` | `#a1a1aa` | labels, secondary text |
| `--fg-faint` | `#a1a1aa` | `#71717a` | placeholders, disabled, meta |
| `--accent` | `#0f766e` | `#2dd4bf` | **the** accent (deep teal) |
| `--accent-hover` | `#115e59` | `#5eead4` | primary button hover |
| `--accent-fg` | `#ffffff` | `#04201d` | text on accent |
| `--accent-subtle` | `#f0fdfa` | `#0b2724` | selected row, active nav background |
| `--accent-border` | `#99f6e4` | `#115e59` | selected outline |

**Status tones.** Each tone has three tokens: `-fg`, `-bg` and `-border`.

| Tone | fg / bg / border (light) | Used for |
|---|---|---|
| `ok` (green) | `#15803d` / `#f0fdf4` / `#bbf7d0` | approved, auto-approved, sent to RIS, ACK `AA`, node done |
| `warn` (amber) | `#b45309` / `#fffbeb` / `#fde68a` | needs review, paused at human review, warnings |
| `bad` (red) | `#b91c1c` / `#fef2f2` / `#fecaca` | rejected, failed, RIS error, ACK `AE`/`AR`, validation errors, node error |
| `idle` (gray) | `#52525b` / `#f4f4f5` / `#e4e4e7` | processing, pending, skipped |

Dark mode inverts the tones to light-on-dark (see the CSS). It is cheap here: every token is a CSS variable and `.dark` on `<html>` swaps them. It is optional; light mode comes first.

**Typography.**

| Role | Font | Size / line height | Weight |
|---|---|---|---|
| UI text | Inter | 13 / 20 | 400 |
| Small / meta | Inter | 12 / 16 | 400 |
| Labels, table headers | Inter | 12 / 16 | 500, `--fg-muted` (no uppercase tracking games) |
| Section titles | Inter | 14 / 20 | 600 |
| Page title | Inter | 16 / 24 | 600 |
| Codes | JetBrains Mono | 12.5 / 18 | 400 |

Fonts are bundled from npm (`@fontsource/*`); no CDN. Numeric columns use `tabular-nums`.

**Spacing.** Tailwind's default scale is the 4 px grid (`1` = 4 px), so use it and don't add arbitrary pixel values.

**Shape and elevation.**

| Token | Value |
|---|---|
| `--radius` | 6 px (`rounded-md`); pills use `rounded-full` only for status badges and counts |
| `--shadow-float` | `0 4px 16px rgb(0 0 0 / 0.08)`, for popovers, menus, dialogs and toasts only |

**Focus.** A 2 px ring in `--accent` at 35% opacity with a 1 px offset (`focus-visible` only).

**Motion.** 120–160 ms, ease-out, no bounce. One looping animation exists: `animate-pulse-ring`, the teal pulse on a running graph node.

## Status vocabulary (one mapping, used everywhere: `src/lib/status.ts`)

| `ReferralStatus` | Label | Tone |
|---|---|---|
| `processing` | Processing | idle |
| `needs_review` | Needs review | warn |
| `auto_approved` | Auto-approved | ok |
| `approved` | Approved | ok |
| `sent_to_ris` | Sent to RIS | ok |
| `ris_error` | RIS error | bad |
| `rejected` | Rejected | bad |
| `failed` | Failed | bad |

**Graph node states:**

| State | Look |
|---|---|
| done | ok border and fg |
| running | accent border plus `animate-pulse-ring` |
| paused at `human_review` | warn fill |
| skipped / not reached | idle, dashed border, faint text |
| error | bad |
| path taken | 2 px accent edges; other edges are 1 px `--border-strong`. Conditional edges are dashed, with a small label chip |

**Confidence:** shown as two-decimal text (e.g. `0.72`) with a 3-step meter. At or above the threshold is neutral, below it is warn, and below 0.5 is bad. The threshold comes from `GET /health`; never hardcode 0.85 in the UI.

## Components

**Primitives** are shadcn/ui-style (Radix + `cva` + `tailwind-merge`) in `src/components/ui/`: `Button`, `Badge`, `Input`, `Textarea`, `Label`, `Table*`, `Tabs*`, `Dialog*`, `Tooltip*`, `Select*`, `DropdownMenu*`, `Popover*`, `ScrollArea`, `Separator`, `Skeleton`, `Kbd`, `Toaster`. Use them; don't hand-roll dialogs, tables (TanStack Table renders into `Table*`) or PDF rendering (react-pdf).

**Shared app components** live in `src/components/`: `StatusBadge`, `Code`, `Confidence`, `EmptyState`, `ErrorState`, `LoadingRows`, `PageHeader`, `KeyValue`.

**Buttons:**

| Variant | Look | Use |
|---|---|---|
| `primary` | accent fill | one per view, e.g. Approve |
| `secondary` | 1 px border, neutral | |
| `ghost` | no border | |
| `danger` | red text, red border on hover | e.g. Reject |

Sizes are `sm` (28 px) and `md` (32 px).

**Tables:** 32 px rows, 1 px row dividers, a sticky header on `--surface`, and a hover row on `--surface-2`. The selected row gets an `--accent-subtle` background and a 2 px accent left bar. Numbers are right-aligned and tabular.

**Panels:** a section title, then content. Separate panels with a 1 px border, not by nesting cards.

**Empty, loading and error states** are required on every data view:
- **Empty:** one line of what to do next.
- **Loading:** skeleton rows, never a spinner.
- **Error:** the HTTP status and message, plus a Retry button.

## Layout
- **Shell:**
  - A left sidebar (208 px, `--surface`) holds the product name, nav (Queue, Pipeline graph, Evals, RIS orders) and the footer chip "Synthetic data · no PHI".
  - A top bar (44 px) holds the page title, the active PIPELINE badge (`graph` / `v1`, read from `GET /health`) and RIS and DB health dots.
- **Referral detail:** a 50/50 split (resizable is nice to have).
  - Left: the fax via react-pdf, with box overlays.
  - Right: a scroll column of Fields (editable inline), Eligibility, Policy citations, Packet, Order/ACK and Review actions. The actions bar is sticky at the bottom.
- **Keyboard:**
  - Queue: `j`/`k` to move, `Enter` to open.
  - Detail: `e` to edit, `a` to approve, `r` to reject, `Esc` to cancel an edit or go back.
  - Show hints with `<Kbd>`.

## Copy
- Sentence case, short, with no exclamation marks.
- Name the actor: "Graph paused at human review", "RIS rejected the order (AE): missing PID".
- Dates in the queue are relative ("12m ago") with an absolute tooltip. Detail screens use `2026-11-23 14:05`.
