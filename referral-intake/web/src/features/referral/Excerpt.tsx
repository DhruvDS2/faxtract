import { useState } from "react";
import { cn } from "@/lib/utils";
import { chunkParts } from "./format";

/** A policy chunk: its section name, then the text clamped to a few lines, expandable. */
export function Excerpt({ text, lines = 3 }: { text: string; lines?: 2 | 3 }) {
  const [open, setOpen] = useState(false);
  const { section, body } = chunkParts(text);
  const long = body.length > (lines === 2 ? 120 : 200) || body.split("\n").length > lines;
  return (
    <div className="mt-1">
      <p className={cn("text-body whitespace-pre-line text-fg-muted wrap-anywhere", !open && (lines === 2 ? "line-clamp-2" : "line-clamp-3"))}>
        {section && <span className="font-medium text-fg">{section}. </span>}
        {body}
      </p>
      {long && (
        <button
          type="button"
          className="mt-0.5 cursor-pointer text-meta text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg hover:decoration-fg-muted"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
