# Referral Intake Pipeline

A diagnostic imaging clinic — radiology, mammography, CT/MRI — receives referrals from
outside physicians. Most still arrive by **fax**. For each one, a front-desk coordinator sits
down and:

1. Reads the fax and types the patient's demographics into the practice system
2. Verifies the patient's insurance is active and in-network
3. Decides whether the requested study needs prior authorization
4. Assembles and submits an authorization packet to the payor
5. Schedules the appointment
6. Creates the imaging order in the RIS so the technologist and radiologist see it

That is **15–25 minutes of manual work per referral, at 30–60 referrals a day.** It is
high-volume, rule-shaped, and the inputs are unstructured and inconsistent — exactly the
profile where an agent pays for itself.

This project automates **steps 1–4 and 6**, with a human review queue in the middle. A faxed
referral goes in one end; a structured order, with prior authorization prepared along the way,
comes out the other end in the RIS.

> ### All data here is synthetic
> Every patient, provider, NPI, payor, member ID, and clinical detail in this project is
> **fabricated**. NPIs are generated to pass checksum validation but are not issued numbers.
> Payors are fictional. **No real patient information (PHI) is used, generated, or stored at
> any point.** This is stated here and shown on screen in the demo.

---

## What it does

```
synthetic fax PDF
  ↓ OCR + vision extraction
structured referral (with per-field confidence)
  ↓ validation rules
flagged / clean referral
  ↓ X12 270 → mock payor → 271
eligibility result
  ↓ payor rules table + policy retrieval
prior auth packet (PDF)
  ↓ human review queue (React)
approved referral
  ↓ HL7 v2 ORM^O01 over MLLP
mock RIS (returns ACK)
```

Wrapped around the pipeline are two more pieces:

- **Eval harness** — runs the whole corpus and scores extraction accuracy, auto-approval rate,
  false-approval rate, cost per referral, and latency per stage.
- **MCP server** — exposes the mock RIS as tools so an LLM can query and operate it
  conversationally, without touching the underlying system.

---

## The numbers that matter

Two outputs are the whole pitch:

- **False-approval rate** — referrals auto-approved that contain at least one field wrong
  against ground truth. In a clinical setting a wrong CPT means a denied claim or the wrong
  study performed, so this is the number to drive to zero. The eval harness sweeps the
  confidence threshold from 0.50 to 0.95 and plots auto-approval rate against false-approval
  rate; the crossover is the recommended operating threshold. The goal is to be able to say
  something like *"at 0.85 we clear 71% of referrals hands-off with zero incorrect CPT codes."*

- **The corrections table** — every edit a reviewer makes in the queue is logged (field name,
  original value, corrected value, original confidence, timestamp). This is the feedback loop
  that tells you which fields the model is actually bad at, and it is what you point to when
  someone asks how the system improves.

---

## Architecture

| Stage | Module | What it does |
|---|---|---|
| 1. Corpus | `corpus/generate_faxes.py` | Renders 60 synthetic referral PDFs from 6 clinic templates, degrades them to look like real faxes, writes `ground_truth.json` |
| 2. Extraction | `app/extract.py` | Tesseract OCR baseline, then Claude vision extraction to a strict schema with per-field confidence |
| 3. Validation | `app/validate.py` | Deterministic rule checks (NPI Luhn, CPT/ICD catalog, laterality, member-ID regex, DOB, confidence threshold) |
| 4. Eligibility | `app/edi.py`, `app/payor.py` | Hand-assembled X12 270, mock payor returns a 271, parsed back to a model |
| 5. Policy | `app/policy.py` | Payor rules table + retrieval over synthetic medical-policy documents |
| 6. Auth packet | `app/auth_packet.py` | Payor-specific prior-auth PDF citing the retrieved policy language |
| 7. Review queue | `web/` | React queue + detail screens; logs every correction |
| 8. Order out | `app/hl7.py`, `app/mllp.py`, `ris/server.py` | Builds `ORM^O01`, sends over MLLP, mock RIS stores it and returns an ACK |
| 9. Evals | `evals/run_evals.py` | Accuracy, threshold sweep, cost, latency → `results.json` + chart |
| 10. MCP | `ris/mcp_server.py` | Exposes the RIS as MCP tools for conversational access |

---

## Tech stack

- **Python 3.11**, FastAPI, Pydantic v2
- **Postgres** (SQLAlchemy)
- **Anthropic API** — Claude Sonnet for extraction, Haiku for cheap subtasks
- **Tesseract** (`pytesseract`) for the OCR baseline
- **pdf2image / Pillow** for rasterization and degradation
- **ReportLab / WeasyPrint** for fax templates and auth packets
- **React + Vite + TypeScript**, TanStack Table for the queue
- **mcp** Python SDK for the RIS server
- **pytest** for the eval harness

---

## Repo layout

```
referral-intake/
  README.md
  pyproject.toml
  schema.sql
  .env.example

  corpus/
    generate_faxes.py
    templates/            # 6 HTML referral-form templates
    fixtures/
      patients.json       # synthetic patients
      providers.json      # synthetic referring physicians + NPIs
      payors.json         # 3 fake payors with rules
      studies.json        # CPT/ICD/study catalog
    out/                  # generated PDFs + ground_truth.json (gitignored)

  app/
    main.py               # FastAPI routes
    db.py
    models.py             # Pydantic schemas
    extract.py            # OCR + vision extraction
    validate.py           # rule checks
    edi.py                # X12 270 build, 271 parse
    payor.py              # mock payor service
    policy.py             # payor policy retrieval (RAG)
    auth_packet.py        # PDF generation
    hl7.py                # ORM^O01 build
    mllp.py               # MLLP client
    pipeline.py           # orchestration

  ris/
    server.py             # mock RIS, MLLP listener
    store.py              # in-memory order store
    mcp_server.py         # MCP tools over the RIS

  evals/
    run_evals.py
    scoring.py
    report.py             # writes results.json + chart

  web/
    src/
      App.tsx
      QueueTable.tsx
      ReviewDetail.tsx
      api.ts
```

---

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install fastapi uvicorn pydantic sqlalchemy psycopg2-binary anthropic \
            pytesseract pdf2image pillow reportlab weasyprint numpy mcp pytest

# system deps
brew install tesseract poppler              # macOS
apt install tesseract-ocr poppler-utils     # Linux

# database
docker run -d --name referral-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16

# web
cd web && npm create vite@latest . -- --template react-ts && npm install
```

Copy `.env.example` to `.env` and fill in your `ANTHROPIC_API_KEY`:

```
ANTHROPIC_API_KEY=
DATABASE_URL=postgresql://postgres:dev@localhost:5432/referral
RIS_MLLP_HOST=localhost
RIS_MLLP_PORT=2575
CONFIDENCE_THRESHOLD=0.85
```

---

## Running it

```bash
# 1. generate the corpus (deterministic from the seed)
python corpus/generate_faxes.py --seed 42 --count 60

# 2. start the mock RIS (MLLP listener)
python ris/server.py

# 3. start the API
uvicorn app.main:app --reload

# 4. start the review queue
cd web && npm run dev

# 5. run the evals
python evals/run_evals.py

# 6. start the MCP server over the RIS
python ris/mcp_server.py
```

---

## The demo

A three-minute walkthrough:

- **0:00–0:15** — a fax goes in through the UI
- **~2:00** — the order appears in the mock RIS as an `ORM^O01`, acknowledged with an ACK
- **~2:30** — the eval numbers: field-level accuracy, the threshold sweep, cost per referral,
  latency

Included in the walkthrough is one **deliberate extraction failure** — caught by validation,
surfaced in the review queue, and fixed by hand before the order is placed. That is the human
review loop working as designed.

---

## Scope

**In scope:** steps 1–4 and 6 of the coordinator workflow, plus the eval harness and MCP server.

**Explicitly out of scope** (do not build): authentication / users / roles / multi-tenancy;
real payor-portal automation; real clearinghouse or EDI VAN connectivity; appointment
scheduling; voice or telephony; retry queues / dead-letter handling / background workers (runs
synchronously); database migrations; Docker Compose for the whole stack; any integration with a
real EHR or RIS product.

---

## Code style

Straightforward, human-natural Python. No comments unless something is genuinely non-obvious.
No abstraction layers for a hypothetical second use case — no `BaseExtractor` with one subclass,
no dependency-injection container, no repository pattern over SQLAlchemy. Flat modules, plain
functions, direct calls. One job per file.

The guiding principle for the build: **get end to end working before making any stage good. An
ugly complete pipeline is worth more than a polished half of one.**
