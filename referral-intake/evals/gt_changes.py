"""What the ground-truth fix changed: writes evals/gt_changes.json.

    python -m evals.gt_changes

"Before" is the truth the committed extraction artifact was scored against
(evals/extraction_eval.json, one truth value per scored field per fax) plus the
pre-fix page fingerprint (evals/gt_prefix_fingerprint.json). "After" is
corpus/generate_faxes.py as it is now, run in memory with the same seed.

For every fax whose truth or print changed it lists each field (old -> new),
whether that field is printed on the page, and whether the page's pixels changed.
Replayed predictions (EXTRACTOR=replay) were read off the *pre-fix* pages, so a
changed printed field makes the replayed value for that field stale; those are
listed in `replay_stale_fields`.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from corpus.generate_faxes import TRUTH_FIELDS, build_corpus, font_files
from evals.safety import write_json_atomic

HERE = Path(__file__).parent
ARTIFACT = HERE / "extraction_eval.json"
FINGERPRINT = HERE / "gt_prefix_fingerprint.json"
OUT = HERE / "gt_changes.json"

RULES = {
    "laterality": "laterality must agree with the study text and the ICD-10 codes "
                  "(mammography CPT 77066 is 'bilateral'; knee/upper-extremity studies take the "
                  "side their right-sided codes name)",
    "patient_address": "the template does not print the address, so the truth is null "
                       "(only template_a prints it)",
}


def page_digests(pages) -> list[str]:
    return [hashlib.sha256(p.tobytes()).hexdigest() for p in pages]


def pre_fix_truth() -> dict[str, dict]:
    """{file: {field: truth}} as the extraction artifact recorded it."""
    records = json.loads(ARTIFACT.read_text())["records"]
    return {r["file"]: {f["field"]: f["truth"] for f in r["fields"]} | {
        "template": r["template"], "degradation": r["degradation"], "pages": r["pages"]}
        for r in records}


def _same(a, b) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def build(seed: int = 42, count: int = 60) -> dict:
    before = pre_fix_truth()
    fingerprint = json.loads(FINGERPRINT.read_text())
    same_fonts = fingerprint["fonts"] == font_files()

    changes, unchanged, truth = [], [], {}
    for name, row, pages in build_corpus(seed, count):
        truth[name] = row
        old = before[name]
        printed_changed = page_digests(pages) != fingerprint["pages"][name] if same_fonts else None
        fields = []
        for field in (*TRUTH_FIELDS, "template", "degradation", "pages"):
            if field in old and not _same(old[field], row.get(field)):
                fields.append({
                    "field": field, "old": old[field], "new": row.get(field),
                    "printed": field in row["boxes"],
                    "rule": RULES.get(field, "unexpected change"),
                })
        stale = [f["field"] for f in fields if f["printed"]]
        if same_fonts and bool(stale) != printed_changed:
            raise AssertionError(f"{name}: printed fields changed={stale} but pixels changed={printed_changed}")
        if fields or printed_changed:
            changes.append({"file": name, "template": row["template"], "degradation": row["degradation"],
                            "printed_changed": bool(stale) if printed_changed is None else printed_changed,
                            "replay_stale_fields": stale, "fields": fields})
        else:
            unchanged.append(name)

    by_field = {}
    for c in changes:
        for f in c["fields"]:
            by_field[f["field"]] = by_field.get(f["field"], 0) + 1
    truth_json = json.dumps(truth, indent=2)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": "corpus/generate_faxes.py",
        "seed": seed, "count": count,
        "before": {"truth": "evals/extraction_eval.json per-field truth (= ground_truth.json at the "
                            "pre-fix generator, commit " + fingerprint["base_commit"] + ")",
                   "pages": "evals/gt_prefix_fingerprint.json"},
        "after": {"truth": "corpus/out/ground_truth.json from the generator at this commit",
                  "ground_truth_sha256": hashlib.sha256(truth_json.encode()).hexdigest()},
        "pixel_check": ("page pixels compared with the pre-fix fingerprint" if same_fonts else
                        "fonts differ from the fingerprint's, so pixel changes are inferred from the "
                        "printed fields instead of measured"),
        "summary": {
            "files": count,
            "files_changed": len(changes),
            "files_unchanged": len(unchanged),
            "pages_reprinted": sum(c["printed_changed"] for c in changes),
            "values_changed_by_field": by_field,
        },
        "rules": RULES,
        "boxes": ("every file's boxes were re-recorded by the new box implementation (tagged values, "
                  "label map warped with the page); boxes are not a truth value and are not listed here"),
        "changes": changes,
        "unchanged_files": unchanged,
    }


def main():
    report = build()
    write_json_atomic(OUT, report)
    s = report["summary"]
    print(f"{s['files_changed']} of {s['files']} files changed "
          f"({s['pages_reprinted']} reprinted); by field: {s['values_changed_by_field']} -> {OUT}")


if __name__ == "__main__":
    main()
