# Referral Intake Pipeline

A diagnostic imaging clinic receives 30–60 referrals a day, most by fax. For each one a coordinator reads the fax, types demographics into the practice system, verifies insurance, works out whether the study needs prior authorization, assembles the auth packet, and creates the order in the RIS. That is 15–25 minutes of work per referral, done by hand, on a document that arrived as a 200-dpi black-and-white scan.

This system automates that path and puts a human in the one place it matters: reviewing what the model was unsure about.

**Every patient, provider, NPI, payor, member ID, and clinical detail in this project is fabricated. NPIs are generated to pass checksum validation but are not issued numbers. Payors are fictional. No real patient information is used at any stage.**

---

## Pipeline

```
synthetic fax PDF
  ↓  extract.py        vision extraction with per-field confidence
structured referral
  ↓  validate.py       NPI checksum, CPT/ICD coherence, payor ID formats, laterality
flagged or clean
  ↓  edi.py + payor.py X12 270 out, 271 back
eligibility
  ↓  auth_packet.py    payor rules decide whether auth is needed and what it requires
auth packet
  ↓  web/              human reviews low-confidence fields, corrections are logged
approved
  ↓  hl7.py → ris/     ORM^O01 over MLLP, mock RIS returns ACK
order in the RIS
```

---

## What already works

- `corpus/generate_faxes.py` — three form templates with different field labels and layouts, populated from fixtures, rendered and degraded into realistic fax scans (skew, speckle, scan lines, cover sheets, margin annotations). Writes `ground_truth.json` alongside.
- `app/validate.py` — NPI Luhn checksum with the 80840 prefix, CPT catalog lookup, CPT-to-study text coherence, laterality requirements, ICD-10 support for the given CPT, per-payor member ID formats, confidence thresholds.
- `app/edi.py` — hand-assembled X12 270 with a balanced ISA/GS/ST envelope, and a 271 parser reading eligibility out of EB segments.
- `app/payor.py` — mock payor returning active in-network, out-of-network, terminated, or not found, deterministically per member ID so reruns are stable.
- `app/hl7.py` — ORM^O01 builder and MLLP client.
- `ris/server.py` — MLLP listener that parses, stores, and ACKs. Returns `MSA|AE` on a malformed message.
- `tests/` — 9 passing tests covering the checksum, envelope balance, EDI round trip, and validation rules.

## Status — complete

Every stage is built and verified end to end on a real run (macOS, Python 3.10, seed 42, 60 faxes):

- **Extraction** (`app/extract.py`) — Claude vision to a strict schema with per-field confidence.
- **Policy retrieval** (`app/policy.py`) — keyword-overlap RAG over 12 synthetic payor policy docs.
- **Auth packet** (`app/auth_packet.py`) — payor-specific PDF that cites the retrieved policy.
- **Eval harness** (`evals/`) — per-field accuracy, threshold sweep, cost, latency, plus a chart.
- **MCP server** (`ris/mcp_server.py`) — five tools over the RIS, driven from a live MCP client.
- **Review UI** (`web/`) — upload, worst-confidence-first queue, fax viewer, inline flags, corrections log.

### Results (seed 42, 60 referrals)

- Every clinically critical field — CPT, member ID, ICD-10, payor, DOB, name, NPI — **100%** exact match.
- Cost **~$0.0145 per referral**; extraction ~8.7s median per fax.
- Auto-approval vs false-approval charted across thresholds 0.50–0.95 (`evals/threshold_sweep.png`).

> Every fax's raw model response is saved next to it as `<name>.raw.json` for live debugging.

---

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .

# system deps
brew install tesseract poppler          # macOS
apt install tesseract-ocr poppler-utils # Linux

cp .env.example .env   # add your ANTHROPIC_API_KEY
```

## Run

```bash
python corpus/build_fixtures.py
python corpus/generate_faxes.py --seed 42 --count 60

python ris/server.py                          # terminal 1, MLLP on 2575
uvicorn app.main:app --reload                 # terminal 2, API on 8000
cd web && npm install && npm run dev          # terminal 3, UI on 5173

pytest
```

Sanity check without the API key:

```bash
python -c "
from datetime import date
from app.models import Referral
from app.edi import build_270, parse_271, pretty
from app.payor import respond
r = Referral(patient_last_name='Strand', patient_first_name='Danielle',
             patient_dob=date(1978,4,12), patient_sex='F', cpt_code='72148',
             payor_name='Meridian Health', member_id='MH123456789')
print(pretty(build_270(r, '1234567893')))
print(parse_271(respond(build_270(r, '1234567893'))))
"
```

---

## Build order

Get end to end working before making any stage good.

1. Fill in `extract.py`, run against 10 faxes, look at what comes out wrong
2. Iterate the prompt — four or five cycles, reading output against ground truth
3. Auth packets and policy retrieval
4. Fax viewer in the review UI
5. Eval harness
6. MCP server
7. Deploy

## Non-goals

Auth, multi-tenancy, real payor portals, real clearinghouse connectivity, scheduling, telephony, retry queues, background workers, database migrations, any real EHR or RIS integration.

## Done means

- A fax uploaded through the UI reaches the mock RIS as an ORM and receives an ACK
- The queue surfaces low-confidence extractions and logs every correction
- `python evals/run_evals.py` reports field-level accuracy, the threshold sweep, cost per referral, and latency
- The MCP server answers `search_patient` and `create_order` from a Claude session
- A three-minute walkthrough exists, including one deliberate extraction failure caught by validation and fixed in the queue
