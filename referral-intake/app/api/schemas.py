"""Response shapes the frozen contract names but app/contracts.py does not define.
They mirror web/src/contracts.ts exactly (change request filed to move them into
app/contracts.py)."""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.contracts import PolicyCitation


class PolicyResult(BaseModel):
    """GET /referrals/{id}/policy (web: PolicyResult)."""
    required: bool
    keywords: list[str] = Field(default_factory=list)
    citations: list[PolicyCitation] = Field(default_factory=list)
