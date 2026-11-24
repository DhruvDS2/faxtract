# Before | after | reference

**Screenshots:**
- **Before:** `docs/design/before/` (v2-ui @ `9d89626`).
- **After:** `docs/design/after/` (ui-upgrade at the gate). Both sets come from the same Playwright spec (`web/e2e/design-shots.spec.ts`), at 1440×900 in light and dark, against a freshly seeded demo.

**References:** the details.so preview frames in `docs/design/refs/`. We took motion and layout only, never colours, logos or text. Each frame is a still, so for motion references compare against the videos in `docs/design/videos/`.

**More evidence:**
- every fault state (RIS down, API error, empty, slow, long names, 0/1 items, extraction pending): `docs/design/after/states/`, 82 shots;
- the frozen screens spec run on the new UI: `docs/design/after/gate/`.

## Queue
| Before | After | Reference |
|---|---|---|
| ![](before/01-queue-light.png) | ![](after/01-queue-light.png) | ![](refs/ohmd-9b7a85-frame0.webp) OhMD rows · ![](refs/terminal-industries-axkwha-frame0.webp) Terminal quick action |
| ![](before/01-queue-dark.png) | ![](after/01-queue-dark.png) | ![](refs/linear-445982-frame0.webp) Linear traveling highlight |
| ![](before/02-queue-keyboard-selected-light.png) | ![](after/02-queue-keyboard-selected-light.png) | ![](refs/onoera-7902cb-frame0.webp) ONOERA hover (rows) |
| ![](before/04-queue-loading-light.png) | ![](after/04-queue-loading-light.png) | ![](refs/paradigmai-586452-frame0.webp) Paradigm progressive fill |
| ![](before/06-queue-error-light.png) | ![](after/06-queue-error-light.png) | (states: plain copy) |

**What changed:**
- The display sentence ("31 referrals need review") counts through when it changes.
- Status tabs with counts replace the select.
- Status is a dot plus text, with the ACK folded in. The Flags and ACK columns are gone.
- Confidence is a plain number, amber only below the threshold.
- One quiet quick action per row ("Review" / "Retry send").
- Selection is neutral (no teal bar).
- Rows fill progressively once per visit.
- Clicking a row morphs it into the detail view (ONTO, `refs/studio-onto-swzj3c-frame0.webp`). See `videos/demo-90s.webm`.

## Referral detail
| Before | After | Reference |
|---|---|---|
| ![](before/10-detail-needs-review-light.png) | ![](after/10-detail-needs-review-light.png) | ![](refs/calendly-1f7d31-frame0.webp) Calendly accordion |
| ![](before/11-detail-edit-422-light.png) | ![](after/11-detail-edit-422-light.png) | (ours: fax camera; field ↔ box) |
| ![](before/14-detail-sent-aa-light.png) | ![](after/14-detail-sent-aa-light.png) | |
| ![](before/15-detail-ris-error-light.png) | ![](after/15-detail-ris-error-light.png) | |
| ![](before/10-detail-needs-review-dark.png) | ![](after/10-detail-needs-review-dark.png) | |

**What changed:**
- The header is the patient name, then one quiet status line. The filled amber, green and red banners are gone.
- "Why it stopped" comes first, and each reason links to its fix.
- Fields are grouped, and confidence shows only when it is low.
- Inline edit moves from error to corrected.
- Clicking a field flies the fax to its box with a 2 px outline (320 ms).
- Eligibility, prior auth and policy (with Compare v1 vs v2), the packet, and HL7/ACK sit in a one-open accordion with summaries.
- Approve steps the status line through Approved → Sending to RIS → Order sent → Sent to RIS · ACK AA, with the resumed path shown. See `videos/human-review.webm`.
- On a cold first open, a page-shaped placeholder shows while the PDF loads.

## Pipeline graph: clean left-to-right flow map (Dhruv's decision)
| Before | After | Reference |
|---|---|---|
| ![](before/21-graph-paused-light.png) | ![](after/21-graph-paused-light.png) | ![](refs/decimals-d10992-frame0.webp) Decimals step reveal |
| ![](before/22-graph-sent-light.png) | ![](after/22-graph-sent-light.png) | ![](refs/ario-7de2db-frame0.webp) Ario timeline |
| ![](before/23-graph-ris-error-node-panel-light.png) | ![](after/23-graph-ris-error-node-panel-light.png) | |
| ![](before/20-graph-empty-light.png) | ![](after/20-graph-empty-light.png) | |

**What changed:**
- The vertical state-machine dump became a left-to-right spine of plain-language steps, each with a one-line result.
- The alternatives (reject, edit loop, RIS retry, no-auth bypass) are faint side branches.
- The taken path is 2 px teal.
- Steps light up in sequence once (Decimals) and live as trace events arrive. See `videos/graph-lights-up.webm`.
- The side panel uses plain words; "Technical details" reveals node ids, the state diff, tokens and cost.
- An Ario-style trace timeline runs beneath the map.
- The layout is still computed from `GET /graph/structure`; nothing is hardcoded.

## Evals
| Before | After | Reference |
|---|---|---|
| ![](before/30-evals-light.png) | ![](after/30-evals-light.png) | ![](refs/stripe-11c89a-frame0.webp) Stripe ruled stats (also stands in for `ohmd-caa5e6`) |
| ![](before/31-evals-full-light.png) | ![](after/31-evals-full-light.png) | ![](refs/lassie-192f2b-frame0.webp) Lassie count-through · ![](refs/effortel-davmwm-frame0.webp) Effortel labelled bars |
| ![](before/32-evals-benchmark-missing-light.png) | ![](after/32-evals-benchmark-missing-light.png) | |

**What changed:**
- The page opens with the headline sentence, built from the API: "v2 retrieves the right policy for 60 of 60 referrals; v1 for 57."
- A ruled row of 4 stats, each labelled with its v1 comparison, counting through once.
- v1/v2 bars in neutral shades that grow once; latency is shown as plain values.
- The false approval is explained in prose.
- Field accuracy runs worst-first with inline bars.
- Per-step timings and method sit behind disclosures.
- Provenance is a quiet footer line that stays visible.

## RIS orders
| Before | After | Reference |
|---|---|---|
| ![](before/40-orders-light.png) | ![](after/40-orders-light.png) | ![](refs/terminal-industries-axkwha-frame0.webp) quiet row action |
| ![](before/07-shell-ris-down-orders-light.png) | ![](after/07-shell-ris-down-orders-light.png) | |
| ![](before/41-orders-empty-light.png) | ![](after/41-orders-empty-light.png) | |

**What changed:**
- The display line reads "3 orders weren't acknowledged by the RIS".
- One status column, with the RIS error faint underneath. The duplicate ACK pill is gone.
- "Retry send" is the row action and updates the row in place.
- RIS down shows as one plain line, and the top bar says "RIS down" in words.

## Shell and page transitions
- **Nav:** text-first with counts, a neutral active state, and the Linear traveling hover highlight.
- **Top bar:** PIPELINE in mono, health in words ("Checking the API…", "API not responding", "RIS down"), and a light/dark/system theme toggle. Dark mode is now reachable.
- **Route change:** crossfade with the nav still (V7, `refs/v7labs-9f6e6d-frame0.webp`).
