import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know the token type scale (text-display/title/body/meta/code)
 * is a font size; otherwise it reads them as colours and drops text-accent etc.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "title", "body", "meta", "code"] }],
      shadow: [{ shadow: ["float"] }],
      duration: [{ duration: ["fast", "state", "panel", "reveal"] }],
      animate: [{ animate: ["breathe", "fade-in", "fade-out", "row-in", "field-in", "pop-in", "pop-out", "dialog-in", "dialog-out", "pulse-ring"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
