"""Synthetic referral faxes plus their ground truth.

    python corpus/generate_faxes.py --seed 42 --count 60

Writes corpus/out/referral_NNN.pdf and corpus/out/ground_truth.json:

    { "referral_NNN.pdf": { <Referral fields>, "modality", "degradation",
                            "template", "pages",
                            "boxes": { field: {page, left, top, width, height} } } }

Boxes are fractions (0-1) of the scanned page, measured *after* the skew and
downscale that degrade() applies, so they overlay any rendering of the PDF.

How boxes are recorded: every template draws a field's value through
Sheet.text() with the value tagged by field name, so the sheet knows exactly
which pixels on the clean page belong to which field (no searching the page
for strings that happen to look like a value). Those regions are painted into a
label map -- one grey level per field -- and the label map is pushed through
the very same rotation and resize as the page (nearest-neighbour, so labels
stay labels). Each field's box is the bounding box of its label afterwards.

Ground-truth rules (see evals/GT_NOTES.md):
  * laterality agrees with the study text and the ICD-10 codes: a study whose
    name says "bilateral" is bilateral; a side-specific study takes the side its
    diagnosis codes name. The random side draw is still made, so the RNG stream
    (and every other value and page) is exactly what it was before the fix.
  * a field the template does not print is null in the truth (patient_address
    is printed only by template_a).
"""
import argparse
import json
import random
import re
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures"
OUT = HERE / "out"

W, H = 1700, 2200
FONT_CANDIDATES = {
    "bold": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ],
    "regular": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ],
    "italic": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf",
    ],
}

# Referral fields that can appear in the truth (app.models.Referral minus metadata).
TRUTH_FIELDS = (
    "patient_first_name", "patient_last_name", "patient_dob", "patient_sex",
    "patient_phone", "patient_address", "referring_provider_name",
    "referring_provider_npi", "referring_practice", "requested_study", "laterality",
    "cpt_code", "icd10_codes", "clinical_indication", "urgency", "payor_name",
    "member_id", "group_id", "order_date",
)

BOX_PAD_PX = 2  # breathing room around the ink, in clean-page pixels


def _font(kind, size):
    for path in FONT_CANDIDATES[kind]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def font_files():
    """Which font file each style resolved to (pixels depend on it)."""
    resolved = {}
    for kind, paths in FONT_CANDIDATES.items():
        resolved[kind] = next((p for p in paths if Path(p).exists()), "PIL default")
    return resolved


def load_fonts():
    return {
        "title": _font("bold", 44),
        "head": _font("bold", 30),
        "label": _font("bold", 24),
        "body": _font("regular", 26),
        "small": _font("regular", 20),
        "hand": _font("italic", 30),
    }


def blank():
    img = Image.new("L", (W, H), 255)
    return img, ImageDraw.Draw(img)


# --------------------------------------------------------------------------
# the page being drawn, and where each field's value went
# --------------------------------------------------------------------------

class Sheet:
    """A clean page plus the pixel region each tagged field value occupies."""

    def __init__(self):
        self.img, self.draw = blank()
        self.regions = {}  # field -> [x0, y0, x1, y1] on the clean page

    def text(self, xy, parts, font):
        """Draw one line of text in a single draw call.

        `parts` is a string, or a list mixing plain strings and (field, value)
        pairs. The pieces are joined and drawn exactly as one string would be;
        each tagged value's ink extent is remembered under its field name.
        """
        if isinstance(parts, str):
            parts = [parts]
        line = "".join(p if isinstance(p, str) else p[1] for p in parts)
        self.draw.text(xy, line, font=font, fill=0)
        x, y = xy
        drawn_so_far = ""
        for part in parts:
            if isinstance(part, str):
                drawn_so_far += part
                continue
            name, value = part
            if value:
                pen = x + font.getlength(drawn_so_far)
                left, top, right, bottom = font.getbbox(value)
                self.mark(name, (pen + left, y + top, pen + right, y + bottom))
            drawn_so_far += value

    def mark(self, name, rect):
        """Record (or widen) the region a field occupies."""
        x0, y0, x1, y1 = rect
        if name in self.regions:
            ox0, oy0, ox1, oy1 = self.regions[name]
            x0, y0, x1, y1 = min(x0, ox0), min(y0, oy0), max(x1, ox1), max(y1, oy1)
        self.regions[name] = [x0, y0, x1, y1]

    def label_map(self):
        """An L-mode image: 0 is background, field i is painted with grey level i+1."""
        img = Image.new("L", (W, H), 0)
        draw = ImageDraw.Draw(img)
        names = sorted(self.regions)
        for level, name in enumerate(names, start=1):
            x0, y0, x1, y1 = self.regions[name]
            draw.rectangle([round(x0) - BOX_PAD_PX, round(y0) - BOX_PAD_PX,
                            round(x1) + BOX_PAD_PX, round(y1) + BOX_PAD_PX], fill=level)
        return img, names

    def boxes_after(self, warp, page_index):
        """Field boxes on the scanned page: the label map, warped like the page."""
        labels, names = self.label_map()
        scanned = warp(labels)
        w, h = scanned.size
        boxes = {}
        for level, name in enumerate(names, start=1):
            bbox = scanned.point(lambda p, level=level: 255 if p == level else 0).getbbox()
            if bbox is None:  # pushed off the page entirely
                continue
            x0, y0, x1, y1 = bbox
            boxes[name] = {"page": page_index,
                           "left": round(x0 / w, 5), "top": round(y0 / h, 5),
                           "width": round((x1 - x0) / w, 5), "height": round((y1 - y0) / h, 5)}
        return boxes


def field(s, fonts, x, y, label, value, width=520, name=None):
    s.text((x, y), label, fonts["label"])
    shown = str(value) if value is not None else ""
    s.text((x, y + 34), [(name, shown)] if name else shown, fonts["body"])
    s.draw.line([(x, y + 74), (x + width, y + 74)], fill=0, width=2)
    return y + 108


def _sex_word(sex):
    return "Male" if sex == "M" else "Female"


def template_a(s, fonts, r):
    """Two-column classic form."""
    c = r["clinic"]
    d = s.draw
    s.text((90, 70), c["name"], fonts["title"])
    s.text((90, 130), f'{c["address"]}, {c["city"]}, {c["state"]} {c["zip"]}', fonts["small"])
    s.text((90, 158), f'Phone {c["phone"]}   Fax {c["fax"]}', fonts["small"])
    d.line([(90, 200), (W - 90, 200)], fill=0, width=3)
    s.text((90, 224), "OUTPATIENT IMAGING REFERRAL", fonts["head"])

    y = 300
    s.text((90, y), "PATIENT INFORMATION", fonts["head"])
    y += 50
    left, right = 90, 900
    y2 = field(s, fonts, left, y, "Patient Last Name", r["patient_last_name"], name="patient_last_name")
    field(s, fonts, right, y, "Patient First Name", r["patient_first_name"], name="patient_first_name")
    y = y2
    y2 = field(s, fonts, left, y, "Date of Birth", r["patient_dob"], name="patient_dob")
    field(s, fonts, right, y, "Sex", r["patient_sex"], name="patient_sex")
    y = y2
    y2 = field(s, fonts, left, y, "Phone", r["patient_phone"], name="patient_phone")
    field(s, fonts, right, y, "Address", r["patient_address"], 700, name="patient_address")
    y = y2 + 20

    s.text((90, y), "INSURANCE", fonts["head"])
    y += 50
    y2 = field(s, fonts, left, y, "Carrier", r["payor_name"], name="payor_name")
    field(s, fonts, right, y, "Member ID", r["member_id"], name="member_id")
    y = y2
    y2 = field(s, fonts, left, y, "Group #", r["group_id"], name="group_id")
    y = y2 + 20

    s.text((90, y), "REQUESTED STUDY", fonts["head"])
    y += 50
    y2 = field(s, fonts, left, y, "Exam Requested", r["requested_study"], 1000, name="requested_study")
    y = y2
    y2 = field(s, fonts, left, y, "CPT", r["cpt_code"], name="cpt_code")
    field(s, fonts, right, y, "Laterality", r["laterality"], name="laterality")
    y = y2
    y2 = field(s, fonts, left, y, "ICD-10 Code(s)", ", ".join(r["icd10_codes"]), 1000, name="icd10_codes")
    y = y2
    s.text((left, y), "Clinical Indication", fonts["label"])
    s.text((left, y + 34), [("clinical_indication", r["clinical_indication"])], fonts["body"])
    d.line([(left, y + 78), (W - 90, y + 78)], fill=0, width=2)
    y += 120
    y2 = field(s, fonts, left, y, "Priority", r["urgency"].upper(), name="urgency")
    field(s, fonts, right, y, "Date of Order", r["order_date"], name="order_date")
    y = y2 + 20

    s.text((90, y), "REFERRING PROVIDER", fonts["head"])
    y += 50
    y2 = field(s, fonts, left, y, "Provider Name", r["referring_provider_name"], name="referring_provider_name")
    field(s, fonts, right, y, "NPI", r["referring_provider_npi"], name="referring_provider_npi")
    y = y2
    field(s, fonts, left, y, "Practice", r["referring_practice"], 1000, name="referring_practice")


def template_b(s, fonts, r):
    """Dense single-column with different labels."""
    c = r["clinic"]
    d = s.draw
    d.rectangle([(60, 60), (W - 60, 190)], outline=0, width=3)
    s.text((85, 80), c["name"].upper(), fonts["head"])
    s.text((85, 122), "RADIOLOGY ORDER FORM  —  FAX TO " + c["fax"], fonts["small"])
    s.text((85, 150), "Please complete all fields. Incomplete forms will be returned.", fonts["small"])

    rows = [
        ("Name of Patient", [("patient_last_name", r["patient_last_name"]), ", ",
                             ("patient_first_name", r["patient_first_name"])]),
        ("DOB", "patient_dob"),
        ("Gender", ("patient_sex", _sex_word(r["patient_sex"]))),
        ("Contact Number", "patient_phone"),
        ("Insurance Company", "payor_name"),
        ("Subscriber ID", "member_id"),
        ("Group", "group_id"),
        ("Procedure", "requested_study"),
        ("CPT Code", "cpt_code"),
        ("Side", "laterality"),
        ("Diagnosis Code", ("icd10_codes", ", ".join(r["icd10_codes"]))),
        ("Reason for Exam", "clinical_indication"),
        ("Stat / Routine", ("urgency", r["urgency"].upper())),
        ("Ordering MD", "referring_provider_name"),
        ("Provider NPI", "referring_provider_npi"),
        ("Clinic", "referring_practice"),
        ("Date", "order_date"),
    ]
    y = 240
    for label, spec in rows:
        if isinstance(spec, str):  # a field printed as-is
            value = r[spec]
            spec = [(spec, str(value) if value is not None else "")]
        elif isinstance(spec, tuple):
            spec = [spec]
        s.text((90, y), label + ":", fonts["label"])
        s.text((640, y), spec, fonts["body"])
        d.line([(630, y + 38), (W - 90, y + 38)], fill=0, width=1)
        y += 62


def _checkbox(d, x, y, checked):
    d.rectangle([(x, y), (x + 30, y + 30)], outline=0, width=2)
    if checked:
        d.line([(x + 4, y + 4), (x + 26, y + 26)], fill=0, width=3)
        d.line([(x + 26, y + 4), (x + 4, y + 26)], fill=0, width=3)


def template_c(s, fonts, r):
    """Checkbox grid plus free-text narrative."""
    c = r["clinic"]
    d = s.draw
    body = fonts["body"]
    s.text((90, 70), c["name"], fonts["title"])
    s.text((90, 132), "IMAGING REQUISITION", fonts["head"])
    d.line([(90, 180), (W - 90, 180)], fill=0, width=2)

    y = 220
    s.text((90, y), ["PATIENT: ", ("patient_last_name", r["patient_last_name"]), ", ",
                     ("patient_first_name", r["patient_first_name"])], body)
    s.text((1000, y), ["DOB: ", ("patient_dob", str(r["patient_dob"]))], body)
    y += 46
    s.text((90, y), ["PH: ", ("patient_phone", str(r["patient_phone"]))], body)
    s.text((1000, y), ["SEX: ", ("patient_sex", str(r["patient_sex"]))], body)
    y += 46
    s.text((90, y), ["INS: ", ("payor_name", str(r["payor_name"])),
                     "   ID: ", ("member_id", str(r["member_id"])),
                     "   GRP: ", ("group_id", str(r["group_id"]))], body)
    y += 70

    s.text((90, y), "MODALITY", fonts["head"])
    y += 50
    x = 100
    for m in ["XR", "US", "CT", "MR", "MG", "NM", "PT"]:
        _checkbox(d, x, y, m == r["modality"])
        s.text((x + 42, y), m, body)
        x += 150
    y += 80

    s.text((90, y), "LATERALITY", fonts["head"])
    y += 50
    x = 100
    ticked = (r["laterality"] or "n/a").upper()
    for lat in ["LEFT", "RIGHT", "BILATERAL", "N/A"]:
        _checkbox(d, x, y, ticked == lat)
        s.text((x + 42, y), lat, body)
        if ticked == lat:  # the value is the ticked box and its caption
            s.mark("laterality", (x, y, x + 42 + body.getbbox(lat)[2], y + 30))
        x += 300
    y += 90

    s.text((90, y), ["EXAM: ", ("requested_study", str(r["requested_study"]))], body)
    y += 46
    s.text((90, y), ["CPT ", ("cpt_code", str(r["cpt_code"])),
                     "    ICD-10 ", ("icd10_codes", ", ".join(r["icd10_codes"]))], body)
    y += 70
    s.text((90, y), "CLINICAL HISTORY / INDICATION", fonts["head"])
    y += 50
    s.text((90, y), [("clinical_indication", r["clinical_indication"])], body)
    d.line([(90, y + 52), (W - 90, y + 52)], fill=0, width=1)
    d.line([(90, y + 112), (W - 90, y + 112)], fill=0, width=1)
    y += 180
    s.text((90, y), ["PRIORITY: ", ("urgency", r["urgency"].upper())], body)
    y += 70
    s.text((90, y), ["ORDERING PROVIDER: ", ("referring_provider_name", str(r["referring_provider_name"]))], body)
    y += 46
    s.text((90, y), ["NPI: ", ("referring_provider_npi", str(r["referring_provider_npi"])),
                     "    DATE: ", ("order_date", str(r["order_date"]))], body)
    y += 46
    s.text((90, y), [("referring_practice", r["referring_practice"])], body)


TEMPLATES = [template_a, template_b, template_c]


def cover_sheet(fonts, r):
    img, d = blank()
    c = r["clinic"]
    d.text((90, 300), "FACSIMILE TRANSMITTAL", font=fonts["title"], fill=0)
    d.line([(90, 370), (W - 90, 370)], fill=0, width=3)
    y = 440
    for label, value in [
        ("TO", c["name"]),
        ("FAX", c["fax"]),
        ("FROM", r["referring_practice"]),
        ("PAGES", "2 including this cover"),
        ("DATE", r["order_date"]),
        ("RE", "Imaging referral"),
    ]:
        d.text((90, y), label + ":", font=fonts["label"], fill=0)
        d.text((400, y), value, font=fonts["body"], fill=0)
        y += 70
    d.text((90, y + 60),
           "CONFIDENTIAL: This transmission is intended only for the named recipient.",
           font=fonts["small"], fill=0)
    d.text((90, y + 96),
           "SYNTHETIC TEST DOCUMENT - NO REAL PATIENT INFORMATION",
           font=fonts["small"], fill=0)
    return img


def annotate(img, fonts, rng):
    d = ImageDraw.Draw(img)
    notes = ["pls call pt to schedule", "auth pending", "urgent - see notes",
             "pt prefers AM appt", "check ins first", "fax back when scheduled"]
    txt = rng.choice(notes)
    layer = Image.new("L", (700, 120), 255)
    ImageDraw.Draw(layer).text((10, 30), txt, font=fonts["hand"], fill=0)
    layer = layer.rotate(rng.uniform(-8, 8), resample=Image.BICUBIC, fillcolor=255)
    img.paste(layer, (rng.randint(900, 1000), rng.randint(1800, 2000)))
    return img


def degrade(img, rng, level):
    """Make a clean page look faxed. Returns (scanned page, warp).

    warp(layer) applies this page's geometry -- the same skew about the page
    centre and the same downscale -- to another W x H image, with
    nearest-neighbour sampling so a label map keeps its labels. Noise,
    scan lines and thresholding do not move anything, so warp skips them.
    """
    import numpy as np

    if level == "clean":
        angle, noise, scanlines, dpi = rng.uniform(-0.4, 0.4), 6, 0, 200
    elif level == "moderate":
        angle, noise, scanlines, dpi = rng.uniform(-1.6, 1.6), 16, rng.randint(0, 2), 150
    else:
        angle, noise, scanlines, dpi = rng.uniform(-3.0, 3.0), 30, rng.randint(1, 3), 120

    size = (int(W * dpi / 200), int(H * dpi / 200))
    img = img.rotate(angle, resample=Image.BICUBIC, fillcolor=255, expand=False)
    small = img.resize(size, Image.LANCZOS)

    a = np.asarray(small).astype(np.int16)
    a += rng.choice([-1, 1]) * np.random.default_rng(rng.randint(0, 10**6)).normal(0, noise, a.shape).astype(np.int16)

    for _ in range(scanlines):
        row = rng.randint(0, a.shape[0] - 1)
        a[row : row + rng.randint(1, 3), :] = rng.choice([0, 255])

    a = np.clip(a, 0, 255).astype("uint8")
    out = Image.fromarray(a)
    out = out.point(lambda p: 255 if p > 135 else 0, mode="1")

    def warp(layer):
        turned = layer.rotate(angle, resample=Image.NEAREST, fillcolor=0, expand=False)
        return turned.resize(size, Image.NEAREST)

    return out.convert("L"), warp


# --------------------------------------------------------------------------
# truth
# --------------------------------------------------------------------------

_SIDE = re.compile(r"\b(bilateral|left|right)\b", re.IGNORECASE)


def side_named(text):
    """'bilateral' / 'left' / 'right' if the text names exactly one of them."""
    sides = {m.lower() for m in _SIDE.findall(text or "")}
    return sides.pop() if len(sides) == 1 else None


def laterality_for(study, icd_descriptions, drawn):
    """The laterality a consistent referral would carry.

    1. A study whose name states a side ("Diagnostic mammography bilateral") has it.
    2. A side-specific study takes the side its diagnosis codes name (every code
       in the catalog for these studies is right-sided: "Pain in right knee").
    3. Only if the codes say nothing does the random draw decide.
    4. Anything else is n/a.
    """
    named = side_named(study["description"])
    if named:
        return named
    if study["laterality_required"]:
        sides = {side_named(d) for d in icd_descriptions} - {None}
        return sides.pop() if len(sides) == 1 else drawn
    return "n/a"


def make_referral(rng, fx, level):
    patients, providers, payors = fx["patients"], fx["providers"], fx["payors"]
    studies, icd10, clinic = fx["studies"]["studies"], fx["studies"]["icd10"], fx["studies"]["clinic"]

    p = rng.choice(patients)
    dr = rng.choice(providers)
    payor = rng.choice(payors)
    study = rng.choice(studies)

    if payor["name"] == "Meridian Health":
        member_id = "MH" + "".join(str(rng.randint(0, 9)) for _ in range(9))
    elif payor["name"] == "Cascade Mutual":
        member_id = "".join(str(rng.randint(0, 9)) for _ in range(11))
    else:
        member_id = "NG-" + "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8))

    icds = rng.sample(study["supporting_icd10"], k=min(2, len(study["supporting_icd10"])))
    # The same draws as the original generator, in the same order, so the stream
    # (and every value after this one) is unchanged; laterality_for() then makes
    # the value agree with the study text and the codes.
    if study["laterality_required"]:
        drawn = rng.choice(["left", "right"])
    elif study["modality"] == "MG":
        drawn = rng.choice(["bilateral", "n/a"])
    else:
        drawn = "n/a"
    lat = laterality_for(study, [icd10[c] for c in icds], drawn)

    indication = rng.choice([
        f'{icd10[icds[0]]}, persistent despite conservative management',
        f'Evaluate for {icd10[icds[0]].lower()}. Symptoms ongoing 8 weeks.',
        f'{icd10[icds[0]]}. Failed PT and NSAIDs.',
        f'Follow-up imaging. History of {icd10[icds[-1]].lower()}.',
    ])

    order_date = date(2026, 1, 1) + timedelta(days=rng.randint(0, 200))

    return {
        "patient_first_name": p["first_name"],
        "patient_last_name": p["last_name"],
        "patient_dob": p["dob"],
        "patient_sex": p["sex"],
        "patient_phone": p["phone"],
        "patient_address": f'{p["address"]}, {p["city"]}, {p["state"]} {p["zip"]}',
        "referring_provider_name": f'{dr["first_name"]} {dr["last_name"]}, MD',
        "referring_provider_npi": dr["npi"],
        "referring_practice": dr["practice"],
        "requested_study": study["description"],
        "modality": study["modality"],
        "cpt_code": study["cpt"],
        "laterality": lat,
        "icd10_codes": icds,
        "clinical_indication": indication,
        "urgency": rng.choices(["routine", "urgent", "stat"], weights=[80, 15, 5])[0],
        "payor_name": payor["name"],
        "member_id": member_id,
        "group_id": "GRP" + "".join(str(rng.randint(0, 9)) for _ in range(5)),
        "order_date": order_date.isoformat(),
        "clinic": clinic,
        "degradation": level,
    }


def load_fixtures():
    return {name: json.loads((FIXTURES / f"{name}.json").read_text())
            for name in ["patients", "providers", "payors", "studies"]}


def build_corpus(seed=42, count=60):
    """Yield (file name, truth row, [page images]) for each referral, in order.

    Nothing is written; main() saves. Tests use this to check the pages and the
    RNG stream in memory.
    """
    rng = random.Random(seed)
    fonts = load_fonts()
    fx = load_fixtures()

    n_clean = int(count * 0.65)
    n_moderate = int(count * 0.25)
    levels = ["clean"] * n_clean + ["moderate"] * n_moderate
    levels += ["hard"] * (count - len(levels))
    rng.shuffle(levels)

    for i, level in enumerate(levels):
        r = make_referral(rng, fx, level)
        tmpl = TEMPLATES[i % len(TEMPLATES)]
        sheet = Sheet()
        tmpl(sheet, fonts, r)

        img = sheet.img
        if rng.random() < 0.15:
            img = annotate(img, fonts, rng)

        page, warp = degrade(img, rng, level)

        pages = []
        if rng.random() < 0.20:
            cover, _ = degrade(cover_sheet(fonts, r), rng, "clean")
            pages.append(cover)
        pages.append(page)  # the referral is always the last page

        truth = {k: v for k, v in r.items() if k != "clinic"}
        for name in TRUTH_FIELDS:  # not on the page -> not in the truth
            if name not in sheet.regions:
                truth[name] = None
        truth["template"] = tmpl.__name__
        truth["pages"] = len(pages)
        truth["boxes"] = sheet.boxes_after(warp, page_index=len(pages) - 1)
        yield f"referral_{i:03d}.pdf", truth, pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--count", type=int, default=60)
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    ground_truth = {}
    for name, truth, pages in build_corpus(args.seed, args.count):
        pages[0].save(out / name, "PDF", resolution=200.0,
                      save_all=True, append_images=pages[1:])
        ground_truth[name] = truth
        print("wrote", name, truth["degradation"])

    (out / "ground_truth.json").write_text(json.dumps(ground_truth, indent=2))
    print(f"\n{len(ground_truth)} referrals + ground_truth.json in {out}")


if __name__ == "__main__":
    main()
