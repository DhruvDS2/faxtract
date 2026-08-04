import argparse
import json
from pathlib import Path

from app.pipeline import process
from evals.report import write_report
from evals.scoring import score_extraction, sweep_thresholds

CORPUS = Path(__file__).parent.parent / "corpus" / "out"

# Approximate Claude Sonnet pricing, dollars per million tokens. Adjust to current rates.
PRICE_PER_MTOK = {"input": 3.0, "output": 15.0}


def percentile(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=str(CORPUS))
    ap.add_argument("--out", default="evals")
    ap.add_argument("--limit", type=int, default=None, help="only run the first N referrals")
    args = ap.parse_args()

    corpus = Path(args.corpus)
    ground_truth = json.loads((corpus / "ground_truth.json").read_text())

    files = sorted(f for f in ground_truth if (corpus / f).exists())
    if args.limit:
        files = files[: args.limit]

    results = []
    for name in files:
        processed = process(corpus / name)
        results.append({
            "file": name,
            "referral": processed.referral,
            "usage": processed.token_usage,
            "timings": processed.stage_timings_ms,
        })
        print("processed", name, processed.status)

    n = len(results)
    accuracy = score_extraction(results, ground_truth)
    sweep = sweep_thresholds(results, ground_truth)

    tot_in = sum(r["usage"].get("input_tokens", 0) for r in results)
    tot_out = sum(r["usage"].get("output_tokens", 0) for r in results)
    dollars = tot_in / 1e6 * PRICE_PER_MTOK["input"] + tot_out / 1e6 * PRICE_PER_MTOK["output"]
    cost = {
        "input_tokens": tot_in,
        "output_tokens": tot_out,
        "total_dollars": round(dollars, 4),
        "dollars_per_referral": round(dollars / n, 4) if n else 0.0,
    }

    stages = {}
    for r in results:
        for stage, ms in r["timings"].items():
            stages.setdefault(stage, []).append(ms)
    latency = {stage: {"p50": round(percentile(v, 0.5), 1), "p95": round(percentile(v, 0.95), 1)}
               for stage, v in stages.items()}

    write_report(n, accuracy, sweep, cost, latency, args.out)

    recommended = next((row for row in sweep if row["false_count"] == 0 and row["auto_count"] > 0), None)

    print("\n=== eval summary ===")
    print(f"referrals: {n}")
    print("field accuracy:")
    for field, s in sorted(accuracy.items(), key=lambda kv: kv[1]["accuracy"]):
        print(f"  {field:28s} {s['accuracy']:.0%} ({s['correct']}/{s['total']})")
    print(f"cost per referral: ${cost['dollars_per_referral']}")
    if recommended:
        print(f"recommended threshold {recommended['threshold']}: "
              f"{recommended['auto_approval_rate']:.0%} auto-approved, 0 false approvals")
    else:
        print("no threshold reached zero false approvals")


if __name__ == "__main__":
    main()
