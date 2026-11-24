import { cn } from "@/lib/utils";

/** Codes (CPT, ICD-10, NPI, member ID, MRN, order IDs) are always monospace. */
export function Code({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <code className={cn("font-mono text-[12.5px] leading-[18px]", className)} {...props} />;
}

/** A block of HL7 / X12 text, one segment per line. */
export function CodeBlock({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <pre className={cn("overflow-x-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-[12px] leading-[18px] text-fg", className)}>
      {lines.join("\n")}
    </pre>
  );
}
