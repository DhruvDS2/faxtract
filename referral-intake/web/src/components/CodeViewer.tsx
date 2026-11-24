import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FEEDBACK_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type CodeFormat = "hl7" | "x12" | "text" | "auto";

type Token = { text: string; kind: "id" | "sep" | "value" };
type Line = Token[];

const HL7_SEP = /([|^~\\&])/;

/** HL7 v2: segments end with \r; the 3-letter segment id leads; |^~\& are separators. */
function hl7(code: string): Line[] {
  return code
    .split(/\r\n|\r|\n/)
    .filter(Boolean)
    .map((seg) => {
      const id = seg.slice(0, 3);
      const rest = seg.slice(3);
      // MSH-2 holds the encoding characters themselves (^~\&): all separators.
      const parts = id === "MSH" && rest.startsWith("|^~\\&") ? ["|", "^~\\&", ...rest.slice(5).split(HL7_SEP)] : rest.split(HL7_SEP);
      return [
        { text: id, kind: "id" },
        ...parts.filter((p) => p !== "").map((p): Token => ({ text: p, kind: /^[|^~\\&]+$/.test(p) ? "sep" : "value" })),
      ];
    });
}

/** X12 (270/271): segments end with ~, elements split on *; the first element is the segment id. */
function x12(code: string): Line[] {
  return code
    .split(/~|\r\n|\r|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const [id, ...els] = seg.split("*");
      const out: Token[] = [{ text: id, kind: "id" }];
      for (const el of els) out.push({ text: "*", kind: "sep" }, ...(el ? [{ text: el, kind: "value" as const }] : []));
      out.push({ text: "~", kind: "sep" });
      return out;
    });
}

const text = (code: string): Line[] => code.split(/\r\n|\r|\n/).map((l) => [{ text: l, kind: "value" }]);

export function detectFormat(code: string): Exclude<CodeFormat, "auto"> {
  const head = code.trimStart().slice(0, 4);
  if (/^(MSH|FHS|BHS)\|/.test(head)) return "hl7";
  if (/^(ISA|GS|ST)\*/.test(head)) return "x12";
  return "text";
}

const KIND: Record<Token["kind"], string> = {
  id: "font-medium text-fg",
  sep: "text-fg-faint",
  value: "text-fg-muted",
};

export type CodeViewerProps = {
  code: string;
  format?: CodeFormat;
  lineNumbers?: boolean;
  /** Show the copy button (default true). */
  copy?: boolean;
  /** A short caption above the code, e.g. "ORM^O01 sent 19:55". */
  label?: React.ReactNode;
  /** Wrap long segments instead of scrolling sideways. */
  wrap?: boolean;
  /** Cap the height (--code-max-h) and scroll. Default true. */
  capHeight?: boolean;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">;

/**
 * HL7 v2 / X12 viewer: one segment per line, the segment id emphasised, separators
 * faint. Line numbers are off by default. Copy puts the raw message on the clipboard.
 */
export function CodeViewer({
  code,
  format = "auto",
  lineNumbers = false,
  copy = true,
  label,
  wrap = false,
  capHeight = true,
  className,
  ...rest
}: CodeViewerProps) {
  const fmt = format === "auto" ? detectFormat(code) : format;
  const lines = useMemo(() => (fmt === "hl7" ? hl7(code) : fmt === "x12" ? x12(code) : text(code)), [code, fmt]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), FEEDBACK_MS);
    } catch {
      /* clipboard blocked: nothing to confirm */
    }
  };

  const copyButton = copy && (
    <Button variant="ghost" size="sm" onClick={onCopy} aria-label={copied ? "Copied" : "Copy message"} className="h-6 px-2">
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );

  return (
    <div className={cn("group/code relative min-w-0 rounded-md bg-surface", className)} data-format={fmt} {...rest}>
      {label && (
        <div className="flex h-8 items-center gap-2 border-b border-border pr-1 pl-3 text-meta text-fg-muted">
          <span className="min-w-0 truncate">{label}</span>
          <span className="ml-auto">{copyButton}</span>
        </div>
      )}
      {!label && copy && (
        <div className="absolute top-1 right-1 z-10 opacity-0 transition-opacity duration-fast group-hover/code:opacity-100 group-focus-within/code:opacity-100">
          {copyButton}
        </div>
      )}
      <pre
        className={cn(
          "overflow-auto px-3 py-2 font-mono text-code",
          capHeight && "max-h-(--code-max-h)",
          wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
        )}
      >
        {lines.map((line, i) => (
          <div key={i} className="flex">
            {lineNumbers && (
              <span aria-hidden className="mr-3 inline-block w-6 shrink-0 text-right text-fg-faint tabular-nums select-none">
                {i + 1}
              </span>
            )}
            <span className="min-w-0">
              {line.map((t, j) => (
                <span key={j} className={KIND[t.kind]}>
                  {t.text}
                </span>
              ))}
              {line.length === 0 && " "}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
