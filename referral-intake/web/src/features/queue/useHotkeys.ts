import { useEffect, useRef } from "react";

/**
 * Single-key shortcuts for Lane D screens (queue + referral detail).
 * Keys are `e.key` values ("j", "Enter", "Escape"); "mod+Enter" means Cmd/Ctrl + Enter.
 * Shortcuts never fire while typing, while a dialog is open, or when a Radix layer
 * (select, tooltip, popover) has already handled the key.
 */
export type Hotkeys = Partial<Record<string, (e: KeyboardEvent) => void>>;

const TYPING = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu'], [role='option']";

function keyName(e: KeyboardEvent): string | null {
  if (e.altKey) return null;
  if (e.metaKey || e.ctrlKey) return `mod+${e.key}`;
  return e.key;
}

export function useHotkeys(bindings: Hotkeys, opts: { enabled?: boolean; allowInInputs?: string[] } = {}) {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });
  const enabled = opts.enabled ?? true;
  const allow = (opts.allowInInputs ?? []).join("|");

  useEffect(() => {
    if (!enabled) return;
    const allowed = allow ? allow.split("|") : [];
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const key = keyName(e);
      if (!key) return;
      const handler = ref.current[key];
      if (!handler) return;
      const target = e.target instanceof Element ? e.target : null;
      if (document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']")) return;
      if (target?.closest(TYPING) && !allowed.includes(key)) return;
      // Enter on a focused button or link belongs to that control.
      if (key === "Enter" && target?.closest("button, a, [role='button']")) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, allow]);
}
