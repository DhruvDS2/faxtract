"""PDF and page-image cache for the fax routes (CONTRACTS section 15).

The API serves the stored fax two ways: the PDF itself (the UI renders it with
react-pdf) and one PNG per page (thumbnails, non-JS use). Both are cached here,
so a queue full of thumbnails or a reviewer flipping pages doesn't re-read or
re-render the same file.

    pdf_bytes(path)              -> (content, strong ETag)
    page_png(path, page, dpi)    -> PNG bytes of one page (page is 0-based, like Box.page)
    page_count(path)             -> number of pages

Every cache key includes the file's resolved path, mtime and size, so a file
that changes on disk is never served stale. All three functions are thread-safe
(uvicorn runs sync routes in a thread pool). A missing file raises
FileNotFoundError; a page outside 0..count-1 raises PageOutOfRange (an
IndexError). The API maps both to 404.

Rendering goes through app.extract.pdf_to_images (pdf2image + poppler), which
renders the whole document. So the first request for any page of a file at a
given dpi caches every page of it.
"""
from __future__ import annotations

import hashlib
import io
import os
import threading
from collections import OrderedDict
from pathlib import Path

__all__ = ["pdf_bytes", "page_png", "page_count", "PageOutOfRange", "clear", "stats"]

# Bounds. Page PNGs at 150 dpi grayscale are roughly 50-300 KB.
MAX_PAGES = 512
MAX_PAGE_BYTES = 96 * 1024 * 1024
MAX_PDFS = 64
MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_COUNTS = 4096


class PageOutOfRange(IndexError):
    pass


FileKey = tuple[str, int, int]  # (resolved path, mtime_ns, size)


def _file_key(path) -> FileKey:
    p = Path(path).resolve()
    st = os.stat(p)  # FileNotFoundError for a missing file
    if not p.is_file():
        raise FileNotFoundError(f"not a file: {p}")
    return (str(p), st.st_mtime_ns, st.st_size)


class _LRU:
    """A size- and count-bounded LRU of bytes-like values. Callers hold the lock."""

    def __init__(self, max_items: int, max_bytes: int):
        self.max_items = max_items
        self.max_bytes = max_bytes
        self.data: OrderedDict = OrderedDict()
        self.nbytes = 0
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _size(value) -> int:
        return len(value[0]) if isinstance(value, tuple) else len(value)

    def get(self, key):
        if key in self.data:
            self.data.move_to_end(key)
            self.hits += 1
            return self.data[key]
        self.misses += 1
        return None

    def put(self, key, value):
        if key in self.data:
            self.nbytes -= self._size(self.data.pop(key))
        size = self._size(value)
        if size > self.max_bytes:  # never cache one value bigger than the whole cache
            return
        self.data[key] = value
        self.nbytes += size
        while len(self.data) > self.max_items or self.nbytes > self.max_bytes:
            _, old = self.data.popitem(last=False)
            self.nbytes -= self._size(old)

    def clear(self):
        self.data.clear()
        self.nbytes = self.hits = self.misses = 0


_lock = threading.Lock()
_pdfs = _LRU(MAX_PDFS, MAX_PDF_BYTES)
_pages = _LRU(MAX_PAGES, MAX_PAGE_BYTES)
_counts: OrderedDict[FileKey, int] = OrderedDict()
# One lock per (file, dpi) render, so concurrent requests for pages of the same
# document wait for a single render instead of each starting their own.
_render_locks: dict[tuple[FileKey, int], threading.Lock] = {}
renders = 0  # how many times a document was rendered (tests read it)


def pdf_bytes(path) -> tuple[bytes, str]:
    """The PDF's bytes and a strong ETag (a quoted sha256 of the content)."""
    key = _file_key(path)
    with _lock:
        hit = _pdfs.get(key)
    if hit is not None:
        return hit
    content = Path(key[0]).read_bytes()
    value = (content, '"' + hashlib.sha256(content).hexdigest() + '"')
    with _lock:
        _pdfs.put(key, value)
    return value


def page_count(path) -> int:
    key = _file_key(path)
    with _lock:
        if key in _counts:
            _counts.move_to_end(key)
            return _counts[key]
    from app import extract  # looked up at call time so tests can monkeypatch it

    n = int(extract.pdf_page_count(key[0]))
    with _lock:
        _set_count(key, n)
    return n


def _set_count(key: FileKey, n: int) -> None:  # caller holds _lock
    _counts[key] = n
    _counts.move_to_end(key)
    while len(_counts) > MAX_COUNTS:
        _counts.popitem(last=False)


def _check_range(key: FileKey, page: int, n: int) -> None:
    if not 0 <= page < n:
        raise PageOutOfRange(f"page {page} out of range: {Path(key[0]).name} has {n} page(s) (0-based)")


def page_png(path, page: int, dpi: int = 150) -> bytes:
    """PNG bytes of `page` (0-based) rendered at `dpi`, grayscale."""
    page, dpi = int(page), int(dpi)
    if dpi < 10 or dpi > 600:
        raise ValueError(f"dpi must be between 10 and 600, got {dpi}")
    key = _file_key(path)
    if page < 0:
        raise PageOutOfRange(f"page {page} out of range (pages are 0-based)")
    with _lock:
        if key in _counts:
            _check_range(key, page, _counts[key])
        hit = _pages.get((key, dpi, page))
        if hit is not None:
            return hit
        render_lock = _render_locks.setdefault((key, dpi), threading.Lock())

    with render_lock:
        with _lock:  # another thread may have rendered it while we waited
            hit = _pages.get((key, dpi, page))
        if hit is None:
            try:
                pngs = _render(key, dpi)
            finally:
                with _lock:
                    _render_locks.pop((key, dpi), None)
            _check_range(key, page, len(pngs))
            hit = pngs[page]
    return hit


def _render(key: FileKey, dpi: int) -> list[bytes]:
    global renders
    from app import extract  # call-time lookup (monkeypatchable); keeps pdf2image lazy

    images = extract.pdf_to_images(key[0], dpi=dpi)
    pngs = []
    for img in images:
        buf = io.BytesIO()
        img.convert("L").save(buf, format="PNG")  # faxes have no colour to keep
        pngs.append(buf.getvalue())
    with _lock:
        renders += 1
        for i, png in enumerate(pngs):
            _pages.put((key, dpi, i), png)
        _set_count(key, len(pngs))
    return pngs


def clear() -> None:
    """Drop every cached entry (tests; or after bulk file changes)."""
    global renders
    with _lock:
        _pdfs.clear()
        _pages.clear()
        _counts.clear()
        renders = 0


def stats() -> dict:
    with _lock:
        return {
            "pdfs": len(_pdfs.data), "pdf_bytes": _pdfs.nbytes,
            "pages": len(_pages.data), "page_bytes": _pages.nbytes,
            "page_hits": _pages.hits, "page_misses": _pages.misses,
            "counts": len(_counts), "renders": renders,
        }
