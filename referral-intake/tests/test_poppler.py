"""Poppler discovery.

pdf2image shells out to Poppler binaries. The Windows build is a portable
archive that winget unpacks without putting anything on PATH, which is why
app.extract looks for it rather than trusting the environment.
"""
import shutil

from app import extract


def test_env_var_wins(monkeypatch):
    monkeypatch.setenv("POPPLER_PATH", r"D:\somewhere\bin")
    assert extract.poppler_dir() == r"D:\somewhere\bin"


def test_returns_none_when_already_on_path(monkeypatch):
    # None tells pdf2image to resolve the binaries itself, which is what we
    # want everywhere brew or apt has installed them.
    monkeypatch.delenv("POPPLER_PATH", raising=False)
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/pdftoppm")
    assert extract.poppler_dir() is None


def test_falls_back_to_a_search_when_not_on_path(monkeypatch):
    monkeypatch.delenv("POPPLER_PATH", raising=False)
    monkeypatch.setattr(shutil, "which", lambda name: None)
    # Either a real install is found or nothing is; both are valid, but the
    # search must not raise on a machine that has no Poppler at all.
    result = extract.poppler_dir()
    assert result is None or result.endswith("bin")
