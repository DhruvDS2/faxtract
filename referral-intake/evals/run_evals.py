import argparse
import json
from pathlib import Path

from evals.scoring import score_extraction, sweep_thresholds

CORPUS = Path(__file__).parent.parent / "corpus" / "out"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=str(CORPUS))
    ap.add_argument("--out", default="evals/results.json")
    args = ap.parse_args()

    corpus = Path(args.corpus)
    ground_truth = json.loads((corpus / "ground_truth.json").read_text())

    # TODO(claude-code): run app.pipeline.process over every pdf in the corpus,
    # collect ProcessedReferral objects plus stage timings and token usage, then:
    #
    #   accuracy        = score_extraction(results, ground_truth)   per field
    #   threshold sweep = sweep_thresholds(results, ground_truth, 0.50 .. 0.95 step 0.05)
    #   cost            = token usage per stage converted to dollars, per referral
    #   latency         = p50 and p95 per stage
    #
    # Write results.json and a single chart plotting auto-approval rate and
    # false-approval rate against threshold. The crossover is the recommended
    # operating threshold.
    raise NotImplementedError


if __name__ == "__main__":
    main()
