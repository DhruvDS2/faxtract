import { Link } from "react-router-dom";
import type { ReferralRecord, TraceEvent } from "@/contracts";
import { StatusDot } from "@/components/StatusPill";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtWhen, ordinalAttempt } from "./format";
import { NODE_WORDS } from "./statusView";
import type { Reason, ReasonTarget } from "./reasons";

const LINK =
  "shrink-0 cursor-pointer text-body text-fg-muted underline decoration-border-strong underline-offset-4 transition-colors duration-fast hover:text-fg hover:decoration-fg-muted";

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby="why-title" className={cn("border-b border-border px-6 pt-5 pb-5", className)}>
      <h2 id="why-title" className="text-title text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReasonList({ reasons, onGo }: { reasons: Reason[]; onGo: (t: ReasonTarget) => void }) {
  return (
    <ol className="mt-2 flex flex-col" data-testid="review-reasons">
      {reasons.map((r) => (
        <li key={r.key} className="flex items-baseline gap-4 py-1">
          <p className={cn("min-w-0 flex-1 text-body wrap-anywhere", r.tone === "bad" ? "text-bad" : "text-fg")}>
            {r.lead && <span className="font-medium">{r.lead}: </span>}
            {r.text}
          </p>
          {r.target && r.link && (
            <button type="button" className={LINK} onClick={() => onGo(r.target!)}>
              {r.link} <span aria-hidden>→</span>
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

type Props = {
  record: ReferralRecord;
  reasons: Reason[];
  blocking: Reason[];
  onGo: (t: ReasonTarget) => void;
};

/**
 * The first thing on the right: why this referral stopped and where to fix it. Each
 * reason is a sentence with a link to the field or panel that resolves it.
 */
export function WhyItStopped({ record, reasons, blocking, onGo }: Props) {
  if (record.status === "needs_review")
    return (
      <Section title="Why it stopped">
        {blocking.length > 0 && (
          <>
            <p className="mt-2 text-body font-medium text-bad" role="alert">
              Approve is blocked until {blocking.length === 1 ? "this is" : "these are"} fixed:
            </p>
            <ReasonList reasons={blocking} onGo={onGo} />
          </>
        )}
        {reasons.length > 0 ? (
          <ReasonList reasons={reasons} onGo={onGo} />
        ) : (
          <p className="mt-2 text-body text-fg-muted">No reason was recorded. Check the fields, then approve or reject.</p>
        )}
      </Section>
    );

  if (record.status === "ris_error") {
    const o = record.order;
    return (
      <Section title="Why it stopped">
        <ol className="mt-2 flex flex-col">
          <li className="flex items-baseline gap-4 py-1">
            <div className="min-w-0 flex-1">
              <p className="text-body text-fg">
                {o.ack_code && o.ack_code !== "AA"
                  ? `The RIS rejected the order (${o.ack_code}) on the ${ordinalAttempt(o.attempts)}. Fix the cause, then retry send.`
                  : `The RIS didn't acknowledge the order on the ${ordinalAttempt(o.attempts)}. Retry send once it's back up.`}
              </p>
              {o.last_error && <p className="font-mono text-code break-words text-fg-faint">{o.last_error}</p>}
            </div>
            <button type="button" className={LINK} onClick={() => onGo({ kind: "panel", panel: "order" })}>
              See the order <span aria-hidden>→</span>
            </button>
          </li>
        </ol>
      </Section>
    );
  }

  if (record.status === "rejected") {
    const r = [...record.reviews].reverse().find((x) => x.action === "reject");
    return (
      <Section title="Why it was rejected">
        <p className="mt-2 text-body text-fg wrap-anywhere">{r?.note ?? "No reason was recorded."}</p>
        {r && (
          <p className="mt-1 text-meta text-fg-muted tabular-nums">
            {r.reviewer ? `${r.reviewer} · ` : ""}
            {fmtDateTime(r.at)}
          </p>
        )}
      </Section>
    );
  }

  if (record.status === "failed")
    return (
      <Section title="Why it stopped">
        <p className="mt-2 text-body text-fg">The pipeline couldn't finish reading this fax. Upload it again to retry.</p>
        {record.error && <p className="mt-1 font-mono text-code break-words text-fg-faint">{record.error}</p>}
      </Section>
    );

  return null;
}

const STEPS = ["extract", "validate", "eligibility", "auth", "retrieve", "packet"];

/** While the pipeline reads the fax: the steps so far, live from the trace. */
export function ReadingTheFax({ record, trace }: { record: ReferralRecord; trace: TraceEvent[] | undefined }) {
  const state = (node: string) => {
    const evs = (trace ?? []).filter((e) => e.node === node);
    const last = evs.at(-1);
    if (!last) return "pending";
    return last.status === "running" ? "running" : last.status === "error" ? "error" : "done";
  };
  const seen = STEPS.filter((s) => state(s) !== "pending");
  const shown = STEPS.slice(0, Math.max(1, Math.min(STEPS.length, seen.length + 1)));
  return (
    <Section title="Reading the fax…">
      <p className="mt-1 text-body text-fg-muted">
        Received {fmtWhen(record.created_at)}. The fields fill in as soon as the pipeline has read them.{" "}
        <Link to={`/graph?referral=${record.id}`} className="text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg-muted">
          Watch it in the pipeline graph
        </Link>
      </p>
      <ol className="mt-3 flex flex-col gap-1" aria-live="polite">
        {shown.map((node) => {
          const s = state(node);
          return (
            <li key={node} className="flex animate-fade-in items-center gap-3 text-body">
              <StatusDot tone={s === "done" ? "ok" : s === "error" ? "bad" : "idle"} running={s === "running"} />
              <span className={s === "pending" ? "text-fg-faint" : s === "running" ? "text-fg" : "text-fg-muted"}>{NODE_WORDS[node] ?? node}</span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
