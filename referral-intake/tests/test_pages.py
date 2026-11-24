"""app/pages.py: the PDF / page-PNG cache behind the fax routes (CONTRACTS section 15)."""
import io
import os
import threading
import time

import pytest
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app import extract, pages

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _make_pdf(path, n_pages=3, label="page"):
    c = canvas.Canvas(str(path), pagesize=letter)
    for i in range(n_pages):
        c.setFont("Helvetica", 28)
        c.drawString(72, 700, f"{label} {i}")
        c.showPage()
    c.save()
    return path


@pytest.fixture(autouse=True)
def _fresh_cache():
    pages.clear()
    yield
    pages.clear()


@pytest.fixture
def pdf(tmp_path):
    return _make_pdf(tmp_path / "referral_900.pdf", n_pages=3)


@pytest.fixture
def count_renders(monkeypatch):
    calls = []
    real = extract.pdf_to_images

    def spy(path, dpi=200):
        calls.append((str(path), dpi))
        return real(path, dpi=dpi)

    monkeypatch.setattr(extract, "pdf_to_images", spy)
    return calls


def _bump(path, data=None):
    """Rewrite a file so its mtime (and maybe size) changes."""
    st = os.stat(path)
    if data is not None:
        path.write_bytes(data)
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))


def test_pdf_bytes_returns_content_and_strong_etag(pdf):
    content, etag = pages.pdf_bytes(pdf)
    assert content == pdf.read_bytes()
    assert etag.startswith('"') and etag.endswith('"') and not etag.startswith("W/")
    assert pages.pdf_bytes(str(pdf)) == (content, etag)  # str and Path hit the same entry
    assert pages.stats()["pdfs"] == 1


def test_pdf_bytes_invalidates_when_file_changes(pdf, tmp_path):
    content, etag = pages.pdf_bytes(pdf)
    other = _make_pdf(tmp_path / "other.pdf", n_pages=1, label="changed")
    _bump(pdf, other.read_bytes())
    content2, etag2 = pages.pdf_bytes(pdf)
    assert content2 == other.read_bytes() and content2 != content
    assert etag2 != etag


def test_same_bytes_same_etag(pdf, tmp_path):
    copy = tmp_path / "copy.pdf"
    copy.write_bytes(pdf.read_bytes())
    assert pages.pdf_bytes(pdf)[1] == pages.pdf_bytes(copy)[1]


def test_page_count(pdf, monkeypatch):
    assert pages.page_count(pdf) == 3
    # cached: a second call must not shell out to pdfinfo again
    monkeypatch.setattr(extract, "pdf_page_count", lambda p: pytest.fail("page_count not cached"))
    assert pages.page_count(pdf) == 3


def test_page_png_renders_each_page(pdf, count_renders):
    pngs = [pages.page_png(pdf, i) for i in range(3)]
    assert all(p.startswith(PNG_MAGIC) for p in pngs)
    assert len(set(pngs)) == 3  # different pages, different images
    img = Image.open(io.BytesIO(pngs[0]))
    assert img.size == (1275, 1650)  # US letter at the default 150 dpi
    assert img.mode == "L"
    # one document render filled the cache for every page
    assert len(count_renders) == 1 and count_renders[0][1] == 150
    assert pages.page_count(pdf) == 3


def test_page_png_is_cached(pdf, count_renders):
    first = pages.page_png(pdf, 1)
    for _ in range(5):
        assert pages.page_png(pdf, 1) is first
    assert len(count_renders) == 1
    assert pages.stats()["page_hits"] >= 5


def test_dpi_is_part_of_the_key(pdf, count_renders):
    small = pages.page_png(pdf, 0, dpi=50)
    big = pages.page_png(pdf, 0, dpi=100)
    assert Image.open(io.BytesIO(small)).size == (425, 550)
    assert Image.open(io.BytesIO(big)).size == (850, 1100)
    assert len(count_renders) == 2


def test_page_png_rerenders_after_file_changes(pdf, tmp_path, count_renders):
    before = pages.page_png(pdf, 0, dpi=50)
    _bump(pdf, _make_pdf(tmp_path / "new.pdf", n_pages=2, label="new").read_bytes())
    after = pages.page_png(pdf, 0, dpi=50)
    assert after != before
    assert len(count_renders) == 2
    assert pages.page_count(pdf) == 2


def test_out_of_range_and_missing(pdf, tmp_path):
    with pytest.raises(pages.PageOutOfRange):
        pages.page_png(pdf, 3, dpi=50)
    with pytest.raises(IndexError):  # PageOutOfRange is an IndexError
        pages.page_png(pdf, -1, dpi=50)
    with pytest.raises(pages.PageOutOfRange):  # count known now: rejected without a render
        pages.page_png(pdf, 7, dpi=50)
    missing = tmp_path / "nope.pdf"
    with pytest.raises(FileNotFoundError):
        pages.pdf_bytes(missing)
    with pytest.raises(FileNotFoundError):
        pages.page_png(missing, 0)
    with pytest.raises(FileNotFoundError):
        pages.page_count(missing)
    with pytest.raises(ValueError):
        pages.page_png(pdf, 0, dpi=5000)


def test_lru_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(pages._pages, "max_items", 4)
    docs = [_make_pdf(tmp_path / f"d{i}.pdf", n_pages=2, label=f"doc{i}") for i in range(4)]
    for d in docs:
        pages.page_png(d, 0, dpi=30)
    st = pages.stats()
    assert st["pages"] == 4  # 8 pages rendered, only the 4 most recent kept
    keys = list(pages._pages.data)
    assert {k[0][0] for k in keys} == {str(docs[2].resolve()), str(docs[3].resolve())}
    assert st["page_bytes"] == sum(len(v) for v in pages._pages.data.values())


def test_lru_byte_bound(tmp_path, monkeypatch):
    pdf = _make_pdf(tmp_path / "b.pdf", n_pages=3)
    one = len(pages.page_png(pdf, 0, dpi=40))
    pages.clear()
    monkeypatch.setattr(pages._pages, "max_bytes", one * 2 + one // 2)
    pages.page_png(pdf, 0, dpi=40)
    assert pages.stats()["page_bytes"] <= pages._pages.max_bytes
    assert pages.stats()["pages"] <= 2


def test_concurrent_requests_render_once(pdf, monkeypatch):
    calls = []
    real = extract.pdf_to_images

    def slow(path, dpi=200):
        calls.append(dpi)
        time.sleep(0.3)  # long enough that every thread arrives mid-render
        return real(path, dpi=dpi)

    monkeypatch.setattr(extract, "pdf_to_images", slow)
    results, errors = [None] * 12, []

    def worker(i):
        try:
            results[i] = pages.page_png(pdf, i % 3, dpi=60)
        except Exception as exc:  # pragma: no cover - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert not errors
    assert len(calls) == 1
    assert all(r and r.startswith(PNG_MAGIC) for r in results)
    assert results[0] == results[3] == results[6]
    assert not pages._render_locks  # no leaked per-document locks


def test_render_error_propagates_and_does_not_poison(pdf, monkeypatch):
    real = extract.pdf_to_images

    def boom(path, dpi=200):
        raise RuntimeError("poppler exploded")

    monkeypatch.setattr(extract, "pdf_to_images", boom)
    with pytest.raises(RuntimeError, match="poppler"):
        pages.page_png(pdf, 0, dpi=40)
    assert not pages._render_locks
    monkeypatch.setattr(extract, "pdf_to_images", real)
    assert pages.page_png(pdf, 0, dpi=40).startswith(PNG_MAGIC)
