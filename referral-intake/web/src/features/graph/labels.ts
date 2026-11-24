/**
 * Plain-language names for pipeline steps (graph node ids) and branches (edge
 * labels). Presentational only: the structure always comes from
 * GET /graph/structure, and an id this map doesn't know falls back to a
 * humanised id ("notify_clinic" → "Notify clinic").
 *
 * Standalone on purpose (no imports): Lane D reuses it for the evals per-step
 * timings, and it can move to lib/ unchanged.
 */

export type StepCopy = {
  /** What a coordinator calls the step. */
  label: string;
  /** One sentence: what the step does. */
  does: string;
};

export const STEP_COPY: Record<string, StepCopy> = {
  extract: {
    label: "Read the fax",
    does: "Reads the faxed referral and pulls out the patient, the study, the codes and the insurance.",
  },
  validate: {
    label: "Check fields",
    does: "Checks every field: formats, CPT and ICD-10 codes, the NPI and the dates.",
  },
  eligibility: {
    label: "Check coverage (270/271)",
    does: "Asks the payor whether the member's coverage is active, with an X12 270 request and its 271 reply.",
  },
  auth: {
    label: "Prior auth rules",
    does: "Applies the payor's prior-authorization rules to this study.",
  },
  retrieve: {
    label: "Find payor policy",
    does: "Finds the payor's medical policy for this study and keeps the passages it cites.",
  },
  packet: {
    label: "Build auth packet",
    does: "Builds the prior-auth packet from the referral and the cited policy.",
  },
  human_review: {
    label: "Human review",
    does: "Pauses so an intake coordinator can fix fields, then approve or reject.",
  },
  order: {
    label: "Send to RIS",
    does: "Sends the order to the RIS as an HL7 ORM message and reads its acknowledgement.",
  },
  ris_wait: {
    label: "Wait for the RIS",
    does: "Holds the order after a RIS error until someone retries the send or rejects the referral.",
  },
  reject: {
    label: "Reject",
    does: "Closes the referral as rejected.",
  },
};

/** The start and end of the graph (LangGraph's __start__ / __end__). */
export const TERMINAL_LABEL = { start: "Fax in", end: "Done" } as const;

/** "notify_clinic" → "Notify clinic"; "__end__" → "End". */
export function humanizeId(id: string): string {
  const words = id.replace(/^_+|_+$/g, "").replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

/** The plain-language label for a step id. */
export function stepLabel(id: string): string {
  return STEP_COPY[id]?.label ?? humanizeId(id);
}

/** What the step does, if we know. */
export function stepDoes(id: string): string | null {
  return STEP_COPY[id]?.does ?? null;
}

/** Branch (edge) labels from the graph, in coordinator words. Unknown labels pass through. */
export const BRANCH_WORDS: Record<string, string> = {
  ok: "read",
  failed: "couldn't read",
  review: "needs review",
  auto: "auto-approve",
  "auth required": "auth required",
  approve: "approved",
  edit: "edit, then recheck",
  reject: "reject",
  sent: "sent",
  "ris error": "RIS error",
  retry: "retry send",
};

export function branchWords(label: string | null | undefined): string | null {
  if (!label) return null;
  return BRANCH_WORDS[label] ?? label;
}
