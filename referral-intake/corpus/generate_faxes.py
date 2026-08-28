import argparse
import json
import math
import random
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


def _font(kind, size):
    for path in FONT_CANDIDATES[kind]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


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


class RecordingDraw:
    """An ImageDraw that remembers every string it puts on the page.

    The three templates render values through a dozen different call sites and
    formats. Rather than thread bookkeeping through all of them, record what
    actually lands on the page and match values against it afterwards.
    """

    def __init__(self, draw):
        self._draw = draw
        self.records = []

    def text(self, xy, text, font=None, **kwargs):
        if text:
            self.records.append((str(text), font, float(xy[0]), float(xy[1])))
        return self._draw.text(xy, text, font=font, **kwargs)

    def __getattr__(self, name):
        return getattr(self._draw, name)


def _drawn_forms(field_name, value):
    """The ways a field's value can appear on a page, most specific first."""
    if value is None or value == "":
        return []
    if field_name == "icd10_codes":
        return [", ".join(value)] + list(value)
    if field_name == "urgency":
        return [value.upper(), value]
    if field_name == "patient_sex":
        return [{"M": "Male", "F": "Female"}.get(value, value), value]
    if field_name == "laterality":
        return [value.upper(), value]
    return [str(value)]


def value_boxes(records, referral):
    """Locate each field's value among the strings drawn, in 0-1 page coords.

    Fields rendered as a checkbox rather than text (laterality on template_c)
    have no string to find and are simply absent, which is honest: there is no
    source region to point a reviewer at.
    """
    boxes = {}
    for field_name, value in referral.items():
        for form in _drawn_forms(field_name, value):
            hit = next(((t, f, x, y) for t, f, x, y in records if form in t), None)
            if hit is None:
                continue
            text, font, x, y = hit
            start = text.index(form)
            x0 = x + font.getlength(text[:start])
            x1 = x0 + font.getlength(form)
            ascent, descent = font.getmetrics()
            boxes[field_name] = {
                "left": x0 / W,
                "top": y / H,
                "width": (x1 - x0) / W,
                "height": (ascent + descent) / H,
            }
            break
    return boxes


def rotate_boxes(boxes, angle):
    """Move boxes with the page when degrade() rotates it.

    Image.rotate(angle) turns the content counter-clockwise on screen, which in
    image coordinates (y down) moves each source point by the clockwise matrix
    below -- verified against a rendered marker. The subsequent downscale is
    uniform, so normalized coordinates survive it untouched.
    """
    if not angle:
        return boxes
    theta = math.radians(angle)
    cos, sin = math.cos(theta), math.sin(theta)

    moved = {}
    for field_name, box in boxes.items():
        corners = [(box["left"], box["top"]),
                   (box["left"] + box["width"], box["top"]),
                   (box["left"], box["top"] + box["height"]),
                   (box["left"] + box["width"], box["top"] + box["height"])]
        points = []
        for nx, ny in corners:
            dx, dy = nx * W - W / 2, ny * H - H / 2
            points.append((((W / 2) + dx * cos + dy * sin) / W,
                           ((H / 2) - dx * sin + dy * cos) / H))
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        moved[field_name] = {"left": min(xs), "top": min(ys),
                             "width": max(xs) - min(xs), "height": max(ys) - min(ys)}
    return moved


def field(d, fonts, x, y, label, value, width=520):
    d.text((x, y), label, font=fonts["label"], fill=0)
    d.text((x, y + 34), str(value) if value is not None else "", font=fonts["body"], fill=0)
    d.line([(x, y + 74), (x + width, y + 74)], fill=0, width=2)
    return y + 108


def template_a(d, fonts, r):
    """Two-column classic form."""
    c = r["clinic"]
    d.text((90, 70), c["name"], font=fonts["title"], fill=0)
    d.text((90, 130), f'{c["address"]}, {c["city"]}, {c["state"]} {c["zip"]}', font=fonts["small"], fill=0)
    d.text((90, 158), f'Phone {c["phone"]}   Fax {c["fax"]}', font=fonts["small"], fill=0)
    d.line([(90, 200), (W - 90, 200)], fill=0, width=3)
    d.text((90, 224), "OUTPATIENT IMAGING REFERRAL", font=fonts["head"], fill=0)

    y = 300
    d.text((90, y), "PATIENT INFORMATION", font=fonts["head"], fill=0)
    y += 50
    left, right = 90, 900
    y2 = field(d, fonts, left, y, "Patient Last Name", r["patient_last_name"])
    field(d, fonts, right, y, "Patient First Name", r["patient_first_name"])
    y = y2
    y2 = field(d, fonts, left, y, "Date of Birth", r["patient_dob"])
    field(d, fonts, right, y, "Sex", r["patient_sex"])
    y = y2
    y2 = field(d, fonts, left, y, "Phone", r["patient_phone"])
    field(d, fonts, right, y, "Address", r["patient_address"], 700)
    y = y2 + 20

    d.text((90, y), "INSURANCE", font=fonts["head"], fill=0)
    y += 50
    y2 = field(d, fonts, left, y, "Carrier", r["payor_name"])
    field(d, fonts, right, y, "Member ID", r["member_id"])
    y = y2
    y2 = field(d, fonts, left, y, "Group #", r["group_id"])
    y = y2 + 20

    d.text((90, y), "REQUESTED STUDY", font=fonts["head"], fill=0)
    y += 50
    y2 = field(d, fonts, left, y, "Exam Requested", r["requested_study"], 1000)
    y = y2
    y2 = field(d, fonts, left, y, "CPT", r["cpt_code"])
    field(d, fonts, right, y, "Laterality", r["laterality"])
    y = y2
    y2 = field(d, fonts, left, y, "ICD-10 Code(s)", ", ".join(r["icd10_codes"]), 1000)
    y = y2
    d.text((left, y), "Clinical Indication", font=fonts["label"], fill=0)
    d.text((left, y + 34), r["clinical_indication"], font=fonts["body"], fill=0)
    d.line([(left, y + 78), (W - 90, y + 78)], fill=0, width=2)
    y += 120
    y2 = field(d, fonts, left, y, "Priority", r["urgency"].upper())
    field(d, fonts, right, y, "Date of Order", r["order_date"])
    y = y2 + 20

    d.text((90, y), "REFERRING PROVIDER", font=fonts["head"], fill=0)
    y += 50
    y2 = field(d, fonts, left, y, "Provider Name", r["referring_provider_name"])
    field(d, fonts, right, y, "NPI", r["referring_provider_npi"])
    y = y2
    field(d, fonts, left, y, "Practice", r["referring_practice"], 1000)


def template_b(d, fonts, r):
    """Dense single-column with different labels."""
    c = r["clinic"]
    d.rectangle([(60, 60), (W - 60, 190)], outline=0, width=3)
    d.text((85, 80), c["name"].upper(), font=fonts["head"], fill=0)
    d.text((85, 122), "RADIOLOGY ORDER FORM  —  FAX TO " + c["fax"], font=fonts["small"], fill=0)
    d.text((85, 150), "Please complete all fields. Incomplete forms will be returned.", font=fonts["small"], fill=0)

    rows = [
        ("Name of Patient", f'{r["patient_last_name"]}, {r["patient_first_name"]}'),
        ("DOB", r["patient_dob"]),
        ("Gender", "Male" if r["patient_sex"] == "M" else "Female"),
        ("Contact Number", r["patient_phone"]),
        ("Insurance Company", r["payor_name"]),
        ("Subscriber ID", r["member_id"]),
        ("Group", r["group_id"]),
        ("Procedure", r["requested_study"]),
        ("CPT Code", r["cpt_code"]),
        ("Side", r["laterality"]),
        ("Diagnosis Code", ", ".join(r["icd10_codes"])),
        ("Reason for Exam", r["clinical_indication"]),
        ("Stat / Routine", r["urgency"].upper()),
        ("Ordering MD", r["referring_provider_name"]),
        ("Provider NPI", r["referring_provider_npi"]),
        ("Clinic", r["referring_practice"]),
        ("Date", r["order_date"]),
    ]
    y = 240
    for label, value in rows:
        d.text((90, y), label + ":", font=fonts["label"], fill=0)
        d.text((640, y), str(value) if value is not None else "", font=fonts["body"], fill=0)
        d.line([(630, y + 38), (W - 90, y + 38)], fill=0, width=1)
        y += 62


def template_c(d, fonts, r):
    """Checkbox grid plus free-text narrative."""
    c = r["clinic"]
    d.text((90, 70), c["name"], font=fonts["title"], fill=0)
    d.text((90, 132), "IMAGING REQUISITION", font=fonts["head"], fill=0)
    d.line([(90, 180), (W - 90, 180)], fill=0, width=2)

    y = 220
    d.text((90, y), f'PATIENT: {r["patient_last_name"]}, {r["patient_first_name"]}', font=fonts["body"], fill=0)
    d.text((1000, y), f'DOB: {r["patient_dob"]}', font=fonts["body"], fill=0)
    y += 46
    d.text((90, y), f'PH: {r["patient_phone"]}', font=fonts["body"], fill=0)
    d.text((1000, y), f'SEX: {r["patient_sex"]}', font=fonts["body"], fill=0)
    y += 46
    d.text((90, y), f'INS: {r["payor_name"]}   ID: {r["member_id"]}   GRP: {r["group_id"]}',
           font=fonts["body"], fill=0)
    y += 70

    d.text((90, y), "MODALITY", font=fonts["head"], fill=0)
    y += 50
    mods = ["XR", "US", "CT", "MR", "MG", "NM", "PT"]
    x = 100
    for m in mods:
        d.rectangle([(x, y), (x + 30, y + 30)], outline=0, width=2)
        if m == r["modality"]:
            d.line([(x + 4, y + 4), (x + 26, y + 26)], fill=0, width=3)
            d.line([(x + 26, y + 4), (x + 4, y + 26)], fill=0, width=3)
        d.text((x + 42, y), m, font=fonts["body"], fill=0)
        x += 150
    y += 80

    d.text((90, y), "LATERALITY", font=fonts["head"], fill=0)
    y += 50
    x = 100
    for lat in ["LEFT", "RIGHT", "BILATERAL", "N/A"]:
        d.rectangle([(x, y), (x + 30, y + 30)], outline=0, width=2)
        if (r["laterality"] or "n/a").upper().replace("N/A", "N/A") == lat:
            d.line([(x + 4, y + 4), (x + 26, y + 26)], fill=0, width=3)
            d.line([(x + 26, y + 4), (x + 4, y + 26)], fill=0, width=3)
        d.text((x + 42, y), lat, font=fonts["body"], fill=0)
        x += 300
    y += 90

    d.text((90, y), f'EXAM: {r["requested_study"]}', font=fonts["body"], fill=0)
    y += 46
    d.text((90, y), f'CPT {r["cpt_code"]}    ICD-10 {", ".join(r["icd10_codes"])}', font=fonts["body"], fill=0)
    y += 70
    d.text((90, y), "CLINICAL HISTORY / INDICATION", font=fonts["head"], fill=0)
    y += 50
    d.text((90, y), r["clinical_indication"], font=fonts["body"], fill=0)
    d.line([(90, y + 52), (W - 90, y + 52)], fill=0, width=1)
    d.line([(90, y + 112), (W - 90, y + 112)], fill=0, width=1)
    y += 180
    d.text((90, y), f'PRIORITY: {r["urgency"].upper()}', font=fonts["body"], fill=0)
    y += 70
    d.text((90, y), f'ORDERING PROVIDER: {r["referring_provider_name"]}', font=fonts["body"], fill=0)
    y += 46
    d.text((90, y), f'NPI: {r["referring_provider_npi"]}    DATE: {r["order_date"]}', font=fonts["body"], fill=0)
    y += 46
    d.text((90, y), r["referring_practice"], font=fonts["body"], fill=0)


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
    import numpy as np

    if level == "clean":
        angle, noise, scanlines, dpi = rng.uniform(-0.4, 0.4), 6, 0, 200
    elif level == "moderate":
        angle, noise, scanlines, dpi = rng.uniform(-1.6, 1.6), 16, rng.randint(0, 2), 150
    else:
        angle, noise, scanlines, dpi = rng.uniform(-3.0, 3.0), 30, rng.randint(1, 3), 120

    img = img.rotate(angle, resample=Image.BICUBIC, fillcolor=255, expand=False)
    small = img.resize((int(W * dpi / 200), int(H * dpi / 200)), Image.LANCZOS)

    a = np.asarray(small).astype(np.int16)
    a += rng.choice([-1, 1]) * np.random.default_rng(rng.randint(0, 10**6)).normal(0, noise, a.shape).astype(np.int16)

    for _ in range(scanlines):
        row = rng.randint(0, a.shape[0] - 1)
        a[row : row + rng.randint(1, 3), :] = rng.choice([0, 255])

    a = np.clip(a, 0, 255).astype("uint8")
    out = Image.fromarray(a)
    out = out.point(lambda p: 255 if p > 135 else 0, mode="1")
    return out.convert("L"), angle


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
    if study["laterality_required"]:
        lat = rng.choice(["left", "right"])
    else:
        lat = rng.choice(["bilateral", "n/a"]) if study["modality"] == "MG" else "n/a"

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--count", type=int, default=60)
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    rng = random.Random(args.seed)
    fonts = load_fonts()
    fx = {name: json.loads((FIXTURES / f"{name}.json").read_text())
          for name in ["patients", "providers", "payors", "studies"]}

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    ground_truth = {}

    n_clean = int(args.count * 0.65)
    n_moderate = int(args.count * 0.25)
    levels = ["clean"] * n_clean + ["moderate"] * n_moderate
    levels += ["hard"] * (args.count - len(levels))
    rng.shuffle(levels)

    for i, level in enumerate(levels):
        r = make_referral(rng, fx, level)
        img, raw = blank()
        d = RecordingDraw(raw)
        tmpl = TEMPLATES[i % len(TEMPLATES)]
        tmpl(d, fonts, r)

        # Capture where each value landed before the page is skewed and scaled.
        boxes = value_boxes(d.records, r)

        if rng.random() < 0.15:
            img = annotate(img, fonts, rng)

        page, angle = degrade(img, rng, level)
        boxes = rotate_boxes(boxes, angle)

        pages = []
        if rng.random() < 0.20:
            cover, _ = degrade(cover_sheet(fonts, r), rng, "clean")
            pages.append(cover)
        pages.append(page)

        # The referral itself is always the last page; a cover sheet shifts it.
        for box in boxes.values():
            box["page"] = len(pages) - 1

        name = f"referral_{i:03d}.pdf"
        pages[0].save(out / name, "PDF", resolution=200.0,
                      save_all=True, append_images=pages[1:])

        gt = {k: v for k, v in r.items() if k != "clinic"}
        gt["template"] = tmpl.__name__
        gt["pages"] = len(pages)
        gt["boxes"] = boxes
        ground_truth[name] = gt
        print("wrote", name, level)

    (out / "ground_truth.json").write_text(json.dumps(ground_truth, indent=2))
    print(f"\n{len(ground_truth)} referrals + ground_truth.json in {out}")


if __name__ == "__main__":
    main()
