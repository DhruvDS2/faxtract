"""Extraction-only eval: run every corpus fax through extract(), compare each
field to ground truth, and dump a detailed JSON the localhost viewer renders.

Unlike run_evals.py (which runs the whole pipeline), this isolates the one thing
we care about here: did extraction fill the fields correctly? For every fax we
record, per field, the predicted value, the ground-truth value, whether they
match under the same normalize/date/list rules the real scorer uses, and the
model's self-reported confidence. Then we aggregate per-field accuracy, overall
accuracy, cost, and latency.

Run:  EXTRACTOR=claude .venv/bin/python -m evals.run_extraction_eval
"""
import json
import time
from pathlib import Path

from dotenv import load_dotenv

from app.extract import engine_name, extract
from app.models import Referral
from evals.scoring import SCORED_FIELDS, field_matches

load_dotenv()

CORPUS = Path(__file__).parent.parent / "corpus" / "out"
OUT = Path(__file__).parent / "extraction_eval.json"

# Claude Sonnet pricing, dollars per million tokens. Adjust to current rates.
PRICE_PER_MTOK = {"input": 3.0, "output": 15.0}


def _val(v):
    """JSON-safe rendering of a field value for the report."""
    if isinstance(v, list):
        return list(v)
    if v is None:
        return None
    return str(v)


def main():
    engine = engine_name()
    if engine == "fixture":
        raise SystemExit("EXTRACTOR=fixture replays ground truth -> fake 100%. "
                         "Use EXTRACTOR=claude or EXTRACTOR=textract.")

    ground_truth = json.loads((CORPUS / "ground_truth.json").read_text())
    files = sorted(f for f in ground_truth if (CORPUS / f).exists())

    records = []
    tot_in = tot_out = 0
    for i, name in enumerate(files, 1):
        gt = ground_truth[name]
        t0 = time.time()
        try:
            referral, usage = extract(CORPUS / name)
            err = None
        except Exception as e:            # keep going; record the failure
            referral, usage, err = Referral(), {}, f"{type(e).__name__}: {e}"
        ms = round((time.time() - t0) * 1000, 1)
        tot_in += usage.get("input_tokens", 0)
        tot_out += usage.get("output_tokens", 0)

        conf = getattr(referral, "confidence", {}) or {}
        fields = []
        correct = total = 0
        for f in SCORED_FIELDS:
            if f not in gt:               # field not present in this fax's truth
                continue
            pred = getattr(referral, f, None)
            ok = field_matches(f, pred, gt[f])
            total += 1
            correct += int(ok)
            fields.append({
                "field": f,
                "predicted": _val(pred),
                "truth": _val(gt[f]),
                "match": ok,
                "confidence": conf.get(f),
            })

        records.append({
            "file": name,
            "template": gt.get("template"),
            "degradation": gt.get("degradation"),
            "pages": gt.get("pages"),
            "latency_ms": ms,
            "usage": usage,
            "error": err,
            "correct": correct,
            "total": total,
            "accuracy": correct / total if total else 0.0,
            "fields": fields,
        })
        print(f"[{i}/{len(files)}] {name}  {correct}/{total}  {ms:.0f}ms"
              + (f"  ERROR {err}" if err else ""))

    # per-field accuracy across the whole corpus
    per_field = {}
    for f in SCORED_FIELDS:
        c = t = 0
        for r in records:
            for fld in r["fields"]:
                if fld["field"] == f:
                    t += 1
                    c += int(fld["match"])
        if t:
            per_field[f] = {"correct": c, "total": t, "accuracy": c / t}

    tot_correct = sum(r["correct"] for r in records)
    tot_total = sum(r["total"] for r in records)
    lats = sorted(r["latency_ms"] for r in records)

    def pct(p):
        if not lats:
            return 0.0
        k = (len(lats) - 1) * p
        lo = int(k)
        hi = min(lo + 1, len(lats) - 1)
        return round(lats[lo] + (lats[hi] - lats[lo]) * (k - lo), 1)

    dollars = tot_in / 1e6 * PRICE_PER_MTOK["input"] + tot_out / 1e6 * PRICE_PER_MTOK["output"]
    summary = {
        "engine": engine,
        "n_files": len(records),
        "overall_accuracy": tot_correct / tot_total if tot_total else 0.0,
        "fields_correct": tot_correct,
        "fields_total": tot_total,
        "per_field": per_field,
        "cost": {
            "input_tokens": tot_in,
            "output_tokens": tot_out,
            "total_dollars": round(dollars, 4),
            "dollars_per_referral": round(dollars / len(records), 4) if records else 0.0,
        },
        "latency_ms": {"p50": pct(0.5), "p95": pct(0.95)},
        "pricing_note": "Claude Sonnet $3/Mtok in, $15/Mtok out. Match rules: "
                        "normalize (lowercase, strip punctuation) for text; first-10-chars "
                        "for dates; order-insensitive set compare for icd10_codes.",
    }

    OUT.write_text(json.dumps({"summary": summary, "records": records}, indent=2))
    print("\n=== summary ===")
    print(f"engine={engine}  files={summary['n_files']}  "
          f"overall accuracy {summary['overall_accuracy']:.1%} "
          f"({tot_correct}/{tot_total})")
    print(f"cost ${summary['cost']['total_dollars']}  "
          f"(${summary['cost']['dollars_per_referral']}/referral)  "
          f"latency p50 {summary['latency_ms']['p50']:.0f}ms p95 {summary['latency_ms']['p95']:.0f}ms")
    print("worst fields:")
    for f, s in sorted(per_field.items(), key=lambda kv: kv[1]["accuracy"])[:6]:
        print(f"  {f:26s} {s['accuracy']:.0%} ({s['correct']}/{s['total']})")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
