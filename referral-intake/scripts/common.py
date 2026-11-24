"""Small helpers shared by the scripts (stdlib only at import time)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # referral-intake/


def ensure_importable() -> None:
    """Let `python scripts/x.py` import app/, graph/ ... without an editable install."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


def load_env() -> None:
    """Load referral-intake/.env if present. Real environment variables win."""
    try:
        from dotenv import load_dotenv
    except ImportError:  # python-dotenv is a declared dependency; tolerate its absence
        return
    load_dotenv(ROOT / ".env", override=False)


def redact(url: str | None) -> str:
    """A database URL safe to print: any password becomes ***."""
    if not url:
        return "<unset>"
    return re.sub(r"(://[^:/@]+):[^@]*@", r"\1:***@", url)


def first_line(exc: BaseException) -> str:
    text = str(exc).strip() or type(exc).__name__
    return text.splitlines()[0]


def explain_db_error(exc: BaseException, url: str | None = None) -> str:
    """One readable line (plus a hint) for the database failures people actually hit."""
    msg = first_line(exc)
    where = redact(url)
    low = str(exc).lower()
    if "does not exist" in low and "database" in low:
        return (f"{msg}. Create it (`createdb -h HOST -p PORT -U USER faxtract`) or let "
                "`python -m scripts.demo pg-up` do it for the demo server")
    if "connection refused" in low or "could not connect" in low or "connection failed" in low:
        return (f"cannot connect to Postgres at {where}: {msg}. Is it running? "
                "(`make demo` / `python -m scripts.demo pg-up` starts one on 127.0.0.1:55432)")
    if 'extension "vector"' in low or "vector.control" in low:
        return (f"{msg}. pgvector is not installed for this Postgres server: `brew install pgvector` "
                "(Homebrew postgresql@16), `apt install postgresql-16-pgvector`, or the "
                "pgvector/pgvector:pg16 image (docker-compose.yml)")
    if "password authentication failed" in low or "no pg_hba.conf entry" in low:
        return f"Postgres refused the login for {where}: {msg}"
    return f"{type(exc).__name__}: {msg}"
