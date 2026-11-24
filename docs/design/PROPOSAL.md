# UI upgrade proposal

The screens, data, flows, API and every `data-testid` stay the same. What changes is hierarchy, colour discipline, motion and the states.

The references are verified in `docs/design/refs/README.md`. The problem numbers (#1–#10) refer to `docs/design/AUDIT.md`.

**Principles that apply to every screen:**
- **Type carries the hierarchy, not boxes.** One display size (22/28, weight 600) per page, usually a sentence that states what matters. Then 15/22 section titles, 13/20 body, 12/16 meta. Mono 12/18 is for codes only. *(#1)*
- **Status colour appears only on the status itself:**
  - a 6 px dot plus a text label in tables (no filled pills);
  - one quiet status line in headers (no filled alert boxes).

  Amber fills only where a person must act now. *(#2)*
- **Teal means "act on this":**
  - primary buttons (Approve, Upload fax, Fix & resume);
  - the row quick action;
  - focus rings;
  - the taken path in the pipeline graph, a logged exception that Dhruv chose.

  Nav selection, links and badges are neutral. *(#3)*
- **Cool neutrals** (slate-blue greys), hairline dividers, an 8 px grid, and small radii (4 / 6).
- **Motion only explains change:**
  - 120 ms hover/press;
  - 200 ms state change;
  - 320 ms panel or page;
  - 600 ms one-time reveals.
  - Enter `cubic-bezier(0.2,0.8,0.2,1)`, exit `cubic-bezier(0.4,0,1,1)`.
  - No bounce. Reduced motion uses opacity fades only. *(#7)*

## Shell (Lane A)
```
┌────────────────┬──────────────────────────────────────────────────────────────────┐
│ ◇ Referral     │                                      graph · RIS ok · DB ok   ◐  │  ← 40px, quiet text, no pills
│   Intake       ├──────────────────────────────────────────────────────────────────┤
│                │                                                                  │
│  Queue      31 │   (page content crossfades here; the nav never moves)            │
│  Pipeline      │                                                                  │
│  Evals         │                                                                  │
│  RIS orders  3 │                                                                  │
│   ▔▔▔▔▔▔▔▔▔▔   │                                                                  │
│  (traveling    │                                                                  │
│   highlight)   │                                                                  │
│                │                                                                  │
│ Synthetic data │                                                                  │
│ · no PHI       │                                                                  │
└────────────────┴──────────────────────────────────────────────────────────────────┘
```
- **Nav** is text-first: no icons, or 14 px glyphs at most. Counts sit on the right in tabular figures (needs review, RIS errors).
- **Active item:** a neutral surface and 500 weight. **No teal.**
- **Hover:** a highlight that glides between items (Linear `linear-445982`, 200 ms).
- **Top bar:** the active PIPELINE as plain mono text, health as words ("RIS down" turns red text), and a ◐ theme toggle so dark mode becomes reachable (#9).
- **Route change:** content crossfades over 320 ms (exit opacity 120 ms, then enter); the nav stays still (V7 `v7labs-9f6e6d`).

## Queue (Lane A)
```
 31 referrals need review                                         [ Upload fax ]   ← display line (count-through on change)
 57 received today · 19 sent to RIS · 3 RIS errors · 4 rejected                      ← 12px meta
 ─────────────────────────────────────────────────────────────────────────────────
 Needs review 31   RIS errors 3   Sent 19   Rejected 4   All 57      Payor ▾        ← tabs replace the status select
 ─────────────────────────────────────────────────────────────────────────────────
 Patient                    Study                           Payor           Conf.   Status            Received
 Novak, Danielle  1976-…    74177  CT abdomen & pelvis w/   Northgate Plan  0.72    ● Needs review    12m        [ Review ]  ← quick action on hover/focus
 Halloran, Devon  1950-…    72148  MRI lumbar spine w/o     Meridian Health 0.85    ● Needs review    12m
 Coleridge, Felix 2002-…    71260  CT chest with contrast   Northgate Plan  0.99    ● RIS error · no ACK  3h  [ Retry send ]
 …
```
- **Hierarchy:**
  - the display sentence is the page title;
  - status tabs with counts replace the status select;
  - the separate Flags and ACK columns fold into the status text ("Sent · AA", "RIS error · AE");
  - confidence becomes a plain number, amber only below the threshold. *(#1, #2)*
- **Rows (OhMD `ohmd-9b7a85`):** 40 px rows, hairline dividers, Patient in 500 weight with the DOB muted, CPT in mono with a muted study description.
- **Hover:** a subtle surface (ONOERA `onoera-7902cb`, 120 ms) plus the traveling highlight between rows (Linear).
- **Quick action:** one quiet button per row on hover or focus, "Review" or "Retry send" (Terminal `terminal-industries-axkwha`).
- **Keyboard:** `j`/`k` moves a neutral selected-row background (no teal left bar). Enter opens the row.
- **Row → detail:** the clicked row's patient block grows into the detail header over 320 ms (ONTO `studio-onto-swzj3c`, a shared-element layout transition).
- **Loading:** rows fill in progressively, top to bottom with 40 ms stagger, cells resolving from skeleton bars (Paradigm `paradigmai-586452`).
- **Empty:** "No referrals yet. Upload a fax to start." **Error:** "Couldn't load referrals. The API isn't responding. Retry". *(#8)*

## Referral detail (Lane B)
```
 ← Queue   Halloran, Clara                                          [ Reject ] [ Edit ] [ Approve ]
           Paused for review · 2 reasons · referral_013.pdf · received 19:55
 ─────────────────────────────────────────┬──────────────────────────────────────────────────
  FAX                         1/1  − 100% +│  Why it stopped
  ┌───────────────────────────────────────┐│   Coverage: member not found (271)          Check coverage →
  │ HOLLIS PARK IMAGING                    ││   Prior auth: prior imaging missing           See policy →
  │ Name  Halloran, [Clara]  ← 2px outline ││  ─────────────────────────────────────────────────
  │ DOB   1959-12-16                        ││  Patient
  │ ...                                     ││   Last name     Halloran
  │      (pans/zooms to the clicked         ││   First name    Ciara        0.95  ← edit inline → "Clara"
  │       field's box, 320ms)               ││   Date of birth 1959-12-16
  └───────────────────────────────────────┘│  Study · Coverage · Referring  (same pattern, grouped)
                                            │  ─────────────────────────────────────────────────
                                            │  ▸ Eligibility (270/271)          Member not found
                                            │  ▾ Prior auth & policy             Required · 6 citations
                                            │      citation rows… [ Compare v1 vs v2 ]
                                            │  ▸ Auth packet                     2 pages
                                            │  ▸ HL7 order & RIS ACK             Not sent yet
```
- **Header:** the patient name as the display line, then one quiet status line. The filled amber, green and red banners are gone. *(#2, #5)*
- **"Why it stopped" comes first:** each review reason is a sentence with a link to the field or panel that fixes it.
- **Fields:**
  - grouped as Patient, Study, Coverage and Referring;
  - confidence shows only when it is below the threshold, or on hover;
  - inline edit has an error state that flips to a corrected state (200 ms) once the value parses.
- **Panels (Calendly accordion `calendly-1f7d31`):** one open at a time, 320 ms height and opacity, each header with a summary on the right. The code viewer highlights HL7/X12 segments (the segment id in mono 500, separators faint).
- **Fax (specified by us):**
  - clicking a field pans and zooms the fax to its bounding box with a soft 2 px outline (320 ms enter curve);
  - hovering a box highlights its field row, and vice versa.
- **The human-review moment as one flow:**
  1. The paused line reads "Paused for review · 2 reasons".
  2. Fix a field; it shows the corrected state.
  3. **Approve.** The status line steps through `Approved → Sending to RIS → Order sent · ACK AA`, with a 3-dot mini path (human review ✓ → order ✓ → ACK ✓) showing the graph resuming, 200 ms per step as events arrive.
  4. The HL7 panel opens to the ACK.
- **First load:** the extraction fields fill in one by one, a 30 ms stagger, once per referral, never on refetch (Paradigm).

## Pipeline graph (Lane C): **clean left-to-right flow map** (Dhruv's decision)
```
 Halloran, Clara · paused at human review                                   [ Fix & resume ]   ← display line + the one action
 ─────────────────────────────────────────────────────────────────────────────────────────────
  Read the fax ─▶ Check fields ─▶ Check coverage ─▶ Prior auth ─┬─▶ Find policy ─▶ Build packet ─┐
   ✓ 9.7 s         ✓ 0.2 ms        ✓ Member not      ✓ Required │    ✓ 6 cited      ✓ 2 pages    │
                                     found                       └─────── no auth ─ ─ ─ ─ ─ ─ ─ ─┤
                                                                                                   ▼
                                                                  ⏸ Human review ─ ─▶ Send to RIS ─ ─▶ ACK
                                                                     ↺ edit (faint)  ╲      ↺ retry (faint)
                                                                                      ╲▶ Reject (faint)
 ─────────────────────────────────────────────────────────────────────────────────────────────
  Trace   0s        2s        4s        6s        8s        10s                                   ← Ario-style axis
  run 1   ████████████████████████████████████████ extract ▌validate ▌… ▌⏸ human review
  run 2                                                                    ▌validate … ⏸ (edit)
                                                            Technical details ◻  (node ids, diffs, tokens, cost)
```
- **Layout:**
  - left to right, columns by rank, with the happy-path spine on one row and plain-language labels ("Check coverage (270/271)") above a one-line result;
  - alternatives (reject, the edit loop, RIS retry, the no-auth bypass) are faint 1 px side branches;
  - the taken path is 2 px teal;
  - the structure is still read from `/graph/structure`, never hardcoded. *(#4)*
- **Reveal (Decimals `decimals-d10992`):** on first load the steps on the taken path light up in sequence: 80 ms stagger, 600 ms total, once. Live runs light each node as its trace event arrives. A running node gets a slow opacity breathe (no glow ring).
- **States:**
  - done: neutral node with a ✓;
  - running: teal outline breathing;
  - paused: amber;
  - skipped: dashed and faint;
  - error: red.
- **Clicking a step** opens a side panel (320 ms slide) with the result, duration, cost and retries in plain words. The state diff sits behind "Technical details".
- **Trace timeline (Ario `ario-7de2db`):** a horizontal time axis, one row per run, with node bars proportional to duration. Hovering a bar highlights its node on the map.
- **Audience:** plain language first. The **Technical details** toggle shows node ids, branch labels, the input/output diff, tokens and cost.

## Evals (Lane D)
```
 v2 retrieves the right policy for 60 of 60 referrals; v1 for 57.                              ← display sentence, from the API
 Same 60 faxes, same extraction and gate · threshold 0.85
 ───────────────────────┬───────────────────────┬───────────────────────┬───────────────────────
  60/60                  │ 55/60                 │ 1                     │ $0.0145                 ← Stripe ruled stat row,
  right policy, with CPT │ right policy, CPT     │ false approval        │ per referral            ← count-through once (Lassie)
  v1: 57/60              │ removed · v1: 48/60   │ both pipelines        │ both pipelines
 ───────────────────────┴───────────────────────┴───────────────────────┴───────────────────────
  v1 vs v2                                         v1                 v2
  Right policy, with CPT        ████████████████████▌ 57    ██████████████████████ 60           ← labelled bars, grow once 600ms
  Right policy, CPT removed     ████████████████ 48         ██████████████████▌ 55
  Pipeline latency p50          ▏0.4 ms                     ██ 57 ms
 ─────────────────────────────────────────────────────────────────────────────────────────────
  The one false approval
  referral_040 · laterality read "bilateral" (0.99) where the page printed "n/a". ...explanation from the API...
 ─────────────────────────────────────────────────────────────────────────────────────────────
  Field accuracy (Claude, 60 faxes)   95.7% overall
  first name 59/60 ▕████████████████████▏  …
 ─────────────────────────────────────────────────────────────────────────────────────────────
  Source  evals/benchmark_v1_v2.json · run 2026-11-23 19:44 · evals/extraction_eval.json · run 2026-08-30   ← quiet footer
```
- **Headline:** a sentence assembled from API numbers, never hardcoded. *(#6)*
- **Stat row (Stripe `stripe-11c89a`; it also substitutes for `ohmd-caa5e6`):** 4 stats on hairline rules, each with a label and its v1 comparison. The numbers count through once on first view (Lassie `lassie-192f2b`).
- **Bars:** v1 vs v2 labelled bars that grow once over 600 ms (Effortel `effortel-davmwm`). v2 is drawn darker; colour does not encode "better".
- **The false approval** is explained as prose with a field diff.
- **Field accuracy** is a compact table with inline bars.
- **Provenance** moves to a quiet footer line that stays visible.
- **States:** 404 shows "No benchmark yet. Run `python -m evals.benchmark`."

## RIS orders (Lane A)
```
 3 orders weren't acknowledged by the RIS                                                         ← display line
 23 sent · 20 acknowledged (AA) · 1 rejected (AE) · 2 never reached the RIS
 ─────────────────────────────────────────────────────────────────────────────────────────────
 All 23   Not acknowledged 3
 Order          Patient           Study    Status                     Attempts  Last attempt
 ORDE70F7E38    Halloran, Clara   74177    ● Sent · ACK AA            1         19:55
 ORD0DA28C3A6   Sorensen, Ellis   73200    ● RIS didn't acknowledge   1         19:44   [ Retry send ]
                                           connection refused (127.0.0.1:2575)
```
- **Status:** one status column ("Sent · ACK AA", "RIS rejected · AE", "RIS didn't acknowledge"). The duplicate ACK pill is gone. *(#2)*
- **Retry send** is the row quick action, and the row updates in place with a 200 ms state change.
- **RIS down** (from `/health`) shows one line under the title: "The RIS isn't answering. New orders will fail until it's back."

## States and performance (Lane E)
- **Every screen designs** its loading, empty, error (with RIS-down and API-down variants), long-name, 0-item and 1-item states.
- **Copy is written for a coordinator.**
- **The mock gains fault modes** (`?mock=empty|error|ris-down|slow`) so each state can be reviewed.
- **Routes are code-split.** The initial JS is under 300 kB gzip for `/queue`; react-pdf, React Flow and the Evals charts load per route.
- **Transitions stay off the main thread:** transforms and opacity only, no long tasks.
