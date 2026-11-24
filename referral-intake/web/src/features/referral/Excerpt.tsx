import { useState } from "react";
import { cn } from "@/lib/utils";
import { plainExcerpt } from "./format";

/** A policy chunk: clamped to a few lines, expandable. */
export function Excerpt({ text, lines = 3 }: { text: string; lines?: 2 | 3 }) {
  const [open, setOpen] = useState(false);
  const clean = plainExcerpt(text);
  const long = clean.length > (lines === 2 ? 140 : 220) || clean.split("\n").length > lines;
  return (
    <div className="mt-1">
      <p className={cn("text-sm whitespace-pre-line text-fg-muted", !open && (lines === 2 ? "line-clamp-2" : "line-clamp-3"))}>{clean}</p>
      {long && (
        <button type="button" className="text-xs text-accent hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
