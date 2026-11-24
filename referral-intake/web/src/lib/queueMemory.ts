/**
 * Queue state that should survive visiting a referral and coming back:
 * the selected row (j/k resume there), the filters (back keeps them) and the
 * headline count last shown (so a change counts through, 31 → 30).
 */
export const queueMemory = { selected: null as string | null, search: "", needsReview: null as number | null };

/** Where "back to the queue" should go: the queue with the filters last used. */
export const queueHref = () => `/queue${queueMemory.search}`;
