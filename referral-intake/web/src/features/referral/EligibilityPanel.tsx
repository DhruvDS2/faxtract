import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ReferralRecord } from "@/contracts";
import { CodeBlock } from "@/components/Code";
import { KeyValue } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { segments } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ELIGIBILITY, fmtMoney, fmtPercent } from "./format";
import { Section } from "./Section";

const Faint = ({ children = "-" }: { children?: React.ReactNode }) => <span className="text-fg-faint">{children}</span>;

/** X12 270/271 result from the payor. */
export function EligibilityPanel({ record }: { record: ReferralRecord }) {
  const [raw, setRaw] = useState(false);
  const e = record.eligibility;
  const s = e ? ELIGIBILITY[e.status] : null;

  return (
    <Section id="eligibility" title="Eligibility" meta="X12 270/271" actions={s && <Badge tone={s.tone}>{s.label}</Badge>}>
      {!e ? (
        <p className="text-sm text-fg-muted">
          {record.status === "processing" ? "The eligibility check has not run yet." : "No eligibility result was recorded."}
        </p>
      ) : (
        <>
          <div className="px-0.5">
            <KeyValue label="Payor">{e.payor_name ?? <Faint />}</KeyValue>
            <KeyValue label="Plan">{e.plan_name ?? <Faint />}</KeyValue>
            <KeyValue label="Deductible remaining">
              <span className="tabular-nums">{fmtMoney(e.deductible_remaining) ?? <Faint />}</span>
            </KeyValue>
            <KeyValue label="Coinsurance">
              <span className="tabular-nums">{fmtPercent(e.coinsurance_percent) ?? <Faint />}</span>
            </KeyValue>
          </div>
          {e.raw_271 ? (
            <div className="mt-1">
              <Button variant="ghost" size="sm" className="-ml-2.5" aria-expanded={raw} aria-controls="raw-271" onClick={() => setRaw((v) => !v)}>
                <ChevronRight aria-hidden className={cn("transition-transform duration-150", raw && "rotate-90")} />
                Raw X12 271
              </Button>
              {raw && (
                <div id="raw-271">
                  <CodeBlock lines={segments(e.raw_271)} className="mt-1 max-h-72 overflow-y-auto" />
                </div>
              )}
            </div>
          ) : (
            <p className="mt-1 text-xs text-fg-faint">No raw 271 stored.</p>
          )}
        </>
      )}
    </Section>
  );
}
