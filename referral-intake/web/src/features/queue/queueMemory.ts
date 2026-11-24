/**
 * Queue state that should survive visiting a referral and coming back:
 * the selected row (j/k resume there) and the filters (back keeps them).
 */
export const queueMemory = { selected: null as string | null, search: "" };

/** Where "back to the queue" should go: the queue with the filters last used. */
export const queueHref = () => `/queue${queueMemory.search}`;
