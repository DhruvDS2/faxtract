# Locked references: verification log

**Verified 2026-11-24.** Each page loads with HTTP 200 at `https://details.so/inspo/<id>`, and its preview frame is saved here as `<id>-frame0.webp`. We take **motion and layout only**: never colours, logos or text.

**Limitation.** The details.so MCP (video frames, captured source) refused service with `monthly_mcp_credit_limit_exceeded`. So each reference was verified from its public page and its single preview frame (`og:image`). Motion therefore comes from the run prompt's motion tokens plus each reference's catalogued interaction, not from frame-by-frame study.

| Slot | ID | Catalogued as | Verdict |
|---|---|---|---|
| Tone + queue rows | `ohmd-9b7a85` | OhMD, features rows | **usable.** Calm clinical tone; generous rows on hairlines. |
| Evals headline stats | `ohmd-caa5e6` | OhMD, stats card | **unusable:** the page loads but publishes no preview (og:image is the generic details.so card) and the MCP is out of credits, so it can't be verified. **Substitute:** `stripe-11c89a` (same *stats* category; its frame shows exactly a ruled row of headline stats with labels), with the OhMD tone kept from `ohmd-9b7a85`. |
| Row hover | `onoera-7902cb` | ONOERA, card hover | **usable,** applied subtly to rows: the hover reveal timing, not the card lift or images. |
| Traveling highlight (nav + rows) | `linear-445982` | Linear, navigation dropdown | **usable.** One highlight that glides between hovered items. |
| Row quick action | `terminal-industries-axkwha` | Terminal Industries, blog rows | **usable.** The frame shows rows with one quiet right-aligned button ("Apply"). It maps to "Review" / "Retry send". |
| Queue → detail | `studio-onto-swzj3c` | ONTO, contextual transition | **usable.** The clicked item grows into the next view (320 ms). |
| Page transitions | `v7labs-9f6e6d` | V7 Labs, page transition | **usable.** Content crossfades while the nav stays still. |
| Pipeline graph reveal | `decimals-d10992` | Decimals, features steps | **usable.** Numbered steps light up in sequence. Applied to the flow map along the path taken. |
| Trace timeline | `ario-7de2db` | Ario, timeline section | **usable.** A horizontal time axis with ticks, using the axis/scrubber layout only, not the giant type. |
| Detail panels | `calendly-1f7d31` | Calendly, features accordion | **usable.** One panel open at a time; the others collapse to their headers. |
| Loading | `paradigmai-586452` | Paradigm, *navigation dropdown* | **usable with caveat.** Catalogued as a nav dropdown, but its frame is Paradigm's dense results table, which is what the slot needs (rows and cells filling progressively). We take only the table fill. |
| Number change | `lassie-192f2b` | Lassie, stats with scroll animation | **usable.** The number counts through to its value once ("0% → …"). |
| Evals stat row | `stripe-11c89a` | Stripe, stats 3D | **usable** for the ruled stat row (4 stats, hairline rules, labels under). The 3D globe is ignored. |
| v1 vs v2 bars | `effortel-davmwm` | Effortel, stats section | **partial.** The frame shows labelled metrics in a product UI but no clear bars. Labelled-bar layout is specified by us: label left, value right, a bar that grows once (600 ms). |
| Fax split view | (none: not on details.so) | | **Specified by us** from document-review tools (DocuSign, Rossum, Hyperscience): field click → pan/zoom to the bbox with a 2 px outline (320 ms); box hover ↔ field. |

`contact.png` is a contact sheet of the frames.
