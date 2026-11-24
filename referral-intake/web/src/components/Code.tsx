import { cn } from "@/lib/utils";
import { CodeViewer } from "./CodeViewer";

/** Codes (CPT, ICD-10, NPI, member ID, MRN, order IDs) are always monospace. */
export function Code({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <code className={cn("font-mono text-code tabular-nums", className)} {...props} />;
}

/** A block of HL7 / X12 text, one segment per line (format detected). */
export function CodeBlock({ lines, className }: { lines: string[]; className?: string }) {
  return <CodeViewer code={lines.join("\n")} format="auto" className={className} />;
}
