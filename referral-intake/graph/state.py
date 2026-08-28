"""The graph's shared notepad (the 'state').

Every node reads from this and writes to it. It is v1's ProcessedReferral data
(the 'story so far') plus 4 new fields, one for each new v2 worker.
"""

from pydantic import BaseModel, Field

from app.models import AuthRequirement, EligibilityResult, Flag, Referral


class GraphState(BaseModel):
    # --- input: the one thing we start with ---
    source_file: str

    # --- carried over from v1's ProcessedReferral (the story so far) ---
    referral: Referral | None = None
    flags: list[Flag] = Field(default_factory=list)
    eligibility: EligibilityResult | None = None
    auth: AuthRequirement | None = None
    status: str = "processing"

    # --- 4 new fields, one per new v2 worker ---
    retry_count: int = 0                     # RETRY: how many times we've re-read
    verification: dict | None = None         # VERIFY: the verifier's verdict
    human_correction: dict | None = None     # HUMAN REVIEW: where a reviewer's fix lands
    retrieved_policy: str | None = None      # POLICY: the top policy text, carried to BUILD PACKET

    # --- RAG + downstream artifacts, filled by the v2 nodes ---
    retrieved_citations: list | None = None  # POLICY: the chunks the packet cites
    keywords: list | None = None             # POLICY: step-2 keywords (the 3-step's learned vocab)
    packet_path: str | None = None           # PACKET: where the generated PDF landed
    order_message: str | None = None         # ORDER: the HL7 ORM^O01 built for the RIS
