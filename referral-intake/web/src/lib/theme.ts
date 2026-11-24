import { useSyncExternalStore } from "react";

/**
 * Theme: localStorage "theme" = "light" | "dark" | "system" (default "system").
 * The resolved theme is applied to <html> as the `.dark` class plus
 * `data-theme="light|dark"`. e2e/design-shots.spec.ts relies on exactly this.
 */
export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEY = "theme";
const listeners = new Set<() => void>();
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system";
  }
}

export const resolveTheme = (pref: ThemePref): Theme => (pref === "system" ? (media?.matches ? "dark" : "light") : pref);

let pref: ThemePref = typeof window !== "undefined" ? readThemePref() : "system";

export function applyTheme(p: ThemePref = pref) {
  if (typeof document === "undefined") return;
  const t = resolveTheme(p);
  const el = document.documentElement;
  el.classList.toggle("dark", t === "dark");
  el.dataset.theme = t;
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  applyTheme(next);
  listeners.forEach((l) => l());
}

// Apply before the first render, and follow the OS while the preference is "system".
applyTheme(pref);
media?.addEventListener("change", () => {
  if (pref !== "system") return;
  applyTheme(pref);
  listeners.forEach((l) => l());
});
if (typeof window !== "undefined") {
  // another tab changed the preference
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    pref = readThemePref();
    applyTheme(pref);
    listeners.forEach((l) => l());
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => `${pref}:${resolveTheme(pref)}`;

/** The stored preference, the theme actually showing, and a setter. */
export function useTheme(): { pref: ThemePref; theme: Theme; setPref: (p: ThemePref) => void } {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [p, t] = s.split(":") as [ThemePref, Theme];
  return { pref: p, theme: t, setPref: setThemePref };
}
