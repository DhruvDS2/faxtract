import { useEffect, useRef } from "react";

export type Hotkey = {
  /** Lowercase `event.key`, e.g. "j", "enter", "?" */
  key: string;
  meta?: boolean;
  shift?: boolean;
  run: () => void;
  /** Allow the binding to fire while a text field has focus. */
  whileTyping?: boolean;
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

/**
 * Document-level bindings for the review loop. Keys are held in a ref so the
 * listener is installed once and never has to be torn down between renders —
 * a rebind mid-keystroke would drop the event.
 */
export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = isTyping(e.target);
      const key = e.key.toLowerCase();
      for (const hk of ref.current) {
        if (hk.key !== key) continue;
        if (!!hk.meta !== (e.metaKey || e.ctrlKey)) continue;
        if (hk.shift !== undefined && hk.shift !== e.shiftKey) continue;
        if (typing && !hk.whileTyping) continue;
        e.preventDefault();
        hk.run();
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** ⌘ on Apple hardware, Ctrl everywhere else. */
export const MOD = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
  ? "⌘"
  : "Ctrl";
