import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const stored = (): Theme | null => {
  try {
    const v = localStorage.getItem("ri-theme");
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

export function useTheme() {
  // Light is the designed default; dark is opt-in and remembered once chosen.
  const [theme, setTheme] = useState<Theme>(() => stored() ?? "light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("ri-theme", theme);
    } catch {
      /* private mode — the class above still applies for this session */
    }
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")) };
}
