"""Command-line demo of the served graph.

    cd referral-intake
    python -m graph.pipeline corpus/out/referral_013.pdf                 # run to the pause
    python -m graph.pipeline corpus/out/referral_013.pdf --then approve  # ...then approve and send

Needs DATABASE_URL (checkpoints + trace rows; read from the environment or
referral-intake/.env -- there is no default). If EXTRACTOR is not set the demo
uses `replay`, the committed real Claude run, so no API key is needed. Approving
sends the ORM to RIS_MLLP_HOST:RIS_MLLP_PORT (start `python -m ris.server`
first, or expect ris_error).
"""
import argparse
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).parent.parent


def _print_trace(referral_id: str, run_ids: set[str] | None = None) -> None:
    from app import trace

    print(f"{'seq':>3}  {'node':<13} {'status':<12} {'ms':>9}  {'att':>3}  {'branch':<13} detail")
    for e in trace.list_for(referral_id):
        if run_ids and e.run_id not in run_ids:
            continue
        if e.status == "running":
            continue
        detail = {k: v for k, v in e.detail.items() if v not in (None, [], {}, "")}
        cost = f"  ${e.cost_usd:.4f}" if e.cost_usd else ""
        print(f"{e.seq:>3}  {e.node:<13} {e.status:<12} {e.duration_ms:>9.2f}  {e.attempt:>3}  "
              f"{(e.branch or '-'):<13} {detail}{cost}" + (f"  error={e.error}" if e.error else ""))


def _summary(record) -> None:
    r = record.referral
    print(f"\nstatus: {record.status}")
    print(f"patient: {r.patient_last_name}, {r.patient_first_name}  CPT {r.cpt_code}  payor {r.payor_name}")
    if record.review_reasons:
        print("review reasons:")
        for reason in record.review_reasons:
            print(f"  - {reason}")
    if record.citations:
        print(f"policy citations: {[c.source for c in record.citations]}")
    if record.order.attempts:
        print(f"order {record.order.order_id}: ack={record.order.ack_code} attempts={record.order.attempts}"
              + (f" last_error={record.order.last_error}" if record.order.last_error else ""))


def main(argv=None) -> None:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")

    ap = argparse.ArgumentParser(prog="python -m graph.pipeline", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", help="a fax PDF, e.g. corpus/out/referral_013.pdf")
    ap.add_argument("--id", default=None, help="referral id (default: 8 random hex chars)")
    ap.add_argument("--pace", type=float, default=0.0, help="replay pacing in seconds (REPLAY_PACE_S)")
    ap.add_argument("--then", choices=["approve", "reject"], default=None,
                    help="resume the pause with this action")
    args = ap.parse_args(argv)

    if not os.getenv("EXTRACTOR"):
        os.environ["EXTRACTOR"] = "replay"
        print("(EXTRACTOR not set: using replay, the committed real Claude run; no key needed)")

    from app import trace
    from app.contracts import ReviewAction
    from app.db import DatabaseNotConfigured, init_db
    from graph.service import GraphRunner

    pdf = Path(args.pdf)
    if not pdf.exists():
        sys.exit(f"{pdf} not found (generate the corpus: python corpus/generate_faxes.py --seed 42 --count 60)")
    try:
        init_db()
    except DatabaseNotConfigured as exc:
        sys.exit(str(exc))

    referral_id = args.id or uuid.uuid4().hex[:8]
    runner = GraphRunner()
    print(f"referral {referral_id}: {pdf.name} -> graph (thread_id={referral_id})\n")
    record = runner.start(referral_id, str(pdf), pdf.name, replay_pace_s=args.pace)
    _print_trace(referral_id)
    _summary(record)

    if args.then and record.status in ("needs_review", "ris_error"):
        if args.then == "approve" and record.status == "ris_error":
            action = ReviewAction(kind="retry_send")
        elif args.then == "approve":
            action = ReviewAction(kind="approve", reviewer="cli")
        else:
            action = ReviewAction(kind="reject", reviewer="cli", note="rejected from the CLI demo")
        print(f"\n--- resume: {action.kind} ---")
        seen = {e.run_id for e in trace.list_for(referral_id)}
        record = runner.resume(record, action)
        new_runs = {e.run_id for e in trace.list_for(referral_id)} - seen
        _print_trace(referral_id, new_runs)
        _summary(record)


if __name__ == "__main__":
    main()
