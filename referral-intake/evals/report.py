import json
from pathlib import Path


def write_report(n_referrals, accuracy, sweep, cost, latency, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    payload = {
        "n_referrals": n_referrals,
        "accuracy": accuracy,
        "threshold_sweep": sweep,
        "cost": cost,
        "latency_ms": latency,
    }
    (out / "results.json").write_text(json.dumps(payload, indent=2))
    _chart(sweep, out / "threshold_sweep.png")
    return payload


def _chart(sweep, path):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed; skipping chart (results.json still written)")
        return

    ts = [r["threshold"] for r in sweep]
    auto = [r["auto_approval_rate"] for r in sweep]
    false = [r["false_approval_rate"] for r in sweep]

    plt.figure(figsize=(8, 5))
    plt.plot(ts, auto, marker="o", label="auto-approval rate")
    plt.plot(ts, false, marker="o", label="false-approval rate")
    plt.xlabel("confidence threshold")
    plt.ylabel("fraction of corpus")
    plt.title("Auto-approval vs false-approval by confidence threshold")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.savefig(path, dpi=120, bbox_inches="tight")
    print("wrote", path)
