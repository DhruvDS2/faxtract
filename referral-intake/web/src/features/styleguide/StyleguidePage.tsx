/**
 * /__styleguide: every token and every base component in every state.
 * Values here are static SAMPLES (labelled); screens read everything from the API.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createColumnHelper } from "@tanstack/react-table";
import { ApiError } from "@/api/client";
import { Accordion, AccordionItem } from "@/components/Accordion";
import { BarComparison } from "@/components/BarComparison";
import { Code } from "@/components/Code";
import { CodeViewer } from "@/components/CodeViewer";
import { ConfidenceMeter } from "@/components/Confidence";
import { CountThrough } from "@/components/CountThrough";
import { DataTable } from "@/components/DataTable";
import { PageHeader, KeyValue } from "@/components/PageHeader";
import { SplitPane } from "@/components/SplitPane";
import { StatRow } from "@/components/StatRow";
import { AckBadge, ReferralStatusPill, StatusBadge } from "@/components/StatusBadge";
import { StatusLine } from "@/components/StatusLine";
import { StatusDot, StatusPill } from "@/components/StatusPill";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TravelingHighlight, useTravelingHighlight } from "@/components/TravelingHighlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { DURATION_MS, EASE, m, useMotionPrefs } from "@/lib/motion";
import { STATUS, type StatusTone } from "@/lib/status";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { ReferralStatus } from "@/contracts";
import { contrast, tokenValue } from "./contrast";
import { MorphDemo, MorphRouteList } from "./MorphDemo";
import { SAMPLE_HL7_ACK, SAMPLE_HL7_ORM, SAMPLE_REFERRALS, SAMPLE_THRESHOLD, SAMPLE_X12_270, type SampleReferral } from "./samples";

// ---------- layout helpers ----------

const SECTIONS = [
  ["colour", "Colour"],
  ["contrast", "Contrast"],
  ["type", "Type"],
  ["space", "Space and shape"],
  ["motion", "Motion"],
  ["buttons", "Buttons"],
  ["forms", "Form controls"],
  ["overlays", "Tabs, menus, overlays"],
  ["status", "Status"],
  ["table", "Data table"],
  ["panels", "Accordion"],
  ["code", "Code viewer"],
  ["stats", "Stats and bars"],
  ["split", "Split pane"],
  ["states", "States"],
  ["header", "Page header"],
  ["morph", "Shared element"],
] as const;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="border-t border-border px-6 py-8">
      <h2 id={`${id}-h`} className="text-title text-fg">
        {title}
      </h2>
      {intro && <p className="mt-1 max-w-2xl text-body text-fg-muted">{intro}</p>}
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </section>
  );
}

/** A labelled specimen row: label column, then the things. */
function Spec({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className="grid grid-cols-[var(--kv-label)_minmax(0,1fr)] items-start gap-4">
      <div className="pt-1.5 text-meta text-fg-faint">{label}</div>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-3", className)}>{children}</div>
    </div>
  );
}

const SampleTag = () => <span className="text-meta font-medium text-fg-faint uppercase">Sample</span>;

// ---------- colour ----------

const COLOUR_GROUPS: { name: string; tokens: string[] }[] = [
  { name: "Neutrals", tokens: ["bg", "surface", "surface-2", "raised", "selected", "border", "border-strong", "control", "fg", "fg-muted", "fg-faint"] },
  { name: "Accent (act on this)", tokens: ["accent", "accent-hover", "accent-fg", "accent-subtle", "accent-border", "focus"] },
  { name: "Status", tokens: ["ok", "warn", "bad", "rejected", "idle", "ok-bg", "warn-bg", "bad-bg"] },
  { name: "Data", tokens: ["chart-1", "chart-2", "chart-track"] },
];

function useTokenValues(names: string[]) {
  const { theme } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    setValues(Object.fromEntries(names.map((n) => [n, tokenValue(n)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
  return values;
}

function Colour() {
  const all = COLOUR_GROUPS.flatMap((g) => g.tokens);
  const values = useTokenValues(all);
  return (
    <>
      {COLOUR_GROUPS.map((g) => (
        <Spec key={g.name} label={g.name} className="items-start gap-x-6 gap-y-4">
          {g.tokens.map((t) => (
            <div key={t} className="flex w-36 items-center gap-2">
              <span className="size-8 shrink-0 rounded-sm border border-border" style={{ background: `var(--${t})` }} />
              <span className="min-w-0">
                <span className="block truncate font-mono text-code text-fg">{t}</span>
                <span className="block font-mono text-meta text-fg-faint">{values[t] || "…"}</span>
              </span>
            </div>
          ))}
        </Spec>
      ))}
    </>
  );
}

const CONTRAST_PAIRS: [string, string, number][] = [
  ["fg", "bg", 4.5],
  ["fg-muted", "bg", 4.5],
  ["fg-faint", "bg", 4.5],
  ["fg-faint", "selected", 4.5],
  ["accent-fg", "accent", 4.5],
  ["accent", "bg", 4.5],
  ["ok", "bg", 4.5],
  ["warn", "bg", 4.5],
  ["bad", "bg", 4.5],
  ["rejected", "bg", 4.5],
  ["idle", "bg", 4.5],
  ["focus", "bg", 3],
  ["control", "bg", 3],
  ["chart-1", "bg", 3],
];

function Contrast() {
  const names = [...new Set(CONTRAST_PAIRS.flatMap(([a, b]) => [a, b]))];
  const v = useTokenValues(names);
  const { theme } = useTheme();
  return (
    <div className="max-w-2xl">
      <table className="w-full border-separate border-spacing-0 text-body">
        <thead>
          <tr className="h-8 text-left text-meta text-fg-muted">
            <th className="border-b border-border font-medium">Pair ({theme})</th>
            <th className="border-b border-border text-right font-medium">Need</th>
            <th className="border-b border-border text-right font-medium">Measured</th>
            <th className="border-b border-border pl-4 font-medium">Specimen</th>
          </tr>
        </thead>
        <tbody>
          {CONTRAST_PAIRS.map(([f, b, need]) => {
            const r = contrast(v[f] ?? "", v[b] ?? "");
            const pass = r != null && r >= need;
            return (
              <tr key={`${f}-${b}`} className="h-9">
                <td className="border-b border-border font-mono text-code">
                  {f} <span className="text-fg-faint">on</span> {b}
                </td>
                <td className="border-b border-border text-right text-fg-muted tabular-nums">{need}:1</td>
                <td className={cn("border-b border-border text-right tabular-nums", pass ? "text-fg" : "text-bad")}>
                  {r == null ? "…" : `${r.toFixed(2)}:1`}
                </td>
                <td className="border-b border-border pl-4">
                  <span className="inline-flex h-6 items-center rounded-sm px-2 text-body" style={{ background: `var(--${b})`, color: `var(--${f})` }}>
                    Needs review
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-meta text-fg-faint">Measured live from the CSS variables. The full table is in web/DESIGN.md (node scripts/contrast.mjs).</p>
    </div>
  );
}

// ---------- type, space, motion ----------

function Type() {
  return (
    <>
      <Spec label="display 22/28 · 600">
        <span className="text-display text-fg">31 referrals need review</span>
      </Spec>
      <Spec label="title 15/22 · 600">
        <span className="text-title text-fg">Prior auth and policy</span>
      </Spec>
      <Spec label="body 13/20 · 400 / 500">
        <span className="text-body text-fg">RIS didn't acknowledge. Retry send.</span>
        <span className="text-body font-medium text-fg">Halloran, Clara</span>
        <span className="text-body text-fg-muted">CT abdomen and pelvis with contrast</span>
      </Spec>
      <Spec label="meta 12/16">
        <span className="text-meta text-fg-muted">57 received today · 19 sent to RIS · 3 RIS errors</span>
      </Spec>
      <Spec label="code 12/18 (codes only)">
        <Code>74177</Code>
        <Code>R10.9</Code>
        <Code>1234567893</Code>
        <Code>NGP448812907</Code>
        <Code>ORDE70F7E38</Code>
      </Spec>
      <Spec label="tabular numerals">
        <span className="text-body text-fg tabular-nums">0.72 · 0.85 · 1,204 · 11.11</span>
      </Spec>
    </>
  );
}

const SPACE = [
  ["1", "4", "w-1"],
  ["2", "8", "w-2"],
  ["4", "16", "w-4"],
  ["6", "24", "w-6"],
  ["8", "32", "w-8"],
  ["12", "48", "w-12"],
  ["16", "64", "w-16"],
] as const;

function Space() {
  return (
    <>
      <Spec label="8 px grid (4 = half step)" className="items-end gap-6">
        {SPACE.map(([k, px, w]) => (
          <div key={k} className="flex flex-col items-start gap-1">
            <span className={cn("h-4 bg-chart-2", w)} />
            <span className="font-mono text-meta text-fg-faint">
              {k} · {px}
            </span>
          </div>
        ))}
      </Spec>
      <Spec label="radius">
        <span className="flex h-10 w-24 items-center justify-center rounded-sm border border-border-strong text-meta text-fg-muted">sm · 4</span>
        <span className="flex h-10 w-24 items-center justify-center rounded-md border border-border-strong text-meta text-fg-muted">md · 6</span>
        <span className="flex h-10 w-24 items-center justify-center rounded-full border border-border-strong text-meta text-fg-muted">dots only</span>
      </Spec>
      <Spec label="hairline / shadow">
        <span className="h-px w-40 bg-border" />
        <span className="flex h-10 w-40 items-center justify-center rounded-md border border-border bg-raised text-meta text-fg-muted shadow-float">floating layers only</span>
      </Spec>
    </>
  );
}

function Motion() {
  const [run, setRun] = useState(0);
  const mp = useMotionPrefs();
  return (
    <>
      <table className="max-w-2xl border-separate border-spacing-0 text-body">
        <thead>
          <tr className="h-8 text-left text-meta text-fg-muted">
            {["Token", "Duration", "Use"].map((h) => (
              <th key={h} className="border-b border-border pr-8 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["--dur-fast", DURATION_MS.fast, "hover, press"],
              ["--dur-state", DURATION_MS.state, "state change"],
              ["--dur-panel", DURATION_MS.panel, "panels, pages, shared element"],
              ["--dur-reveal", DURATION_MS.reveal, "one-time reveals"],
              ["--dur-breathe", DURATION_MS.breathe, "the one loop: running (opacity)"],
            ] as const
          ).map(([t, ms, use]) => (
            <tr key={t} className="h-9">
              <td className="border-b border-border pr-8 font-mono text-code">{t}</td>
              <td className="border-b border-border pr-8 text-fg-muted tabular-nums">{ms} ms</td>
              <td className="border-b border-border pr-8 text-fg-muted">{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Spec label="easing">
        <span className="text-body text-fg-muted">
          enter <Code>{`(${EASE.enter.join(", ")})`}</Code> · exit <Code>{`(${EASE.exit.join(", ")})`}</Code> · cubic Bézier, no bounce
        </span>
      </Spec>
      <Spec label={`variants${mp.reduce ? " (reduced: fades)" : ""}`} className="gap-6">
        <Button size="sm" onClick={() => setRun((r) => r + 1)}>
          Replay
        </Button>
        <m.span key={`f${run}`} variants={mp.fade} initial="initial" animate="animate" className="text-meta text-fg-muted">
          fade
        </m.span>
        <m.span key={`p${run}`} variants={mp.panelSlide("right")} initial="initial" animate="animate" className="inline-block text-meta text-fg-muted">
          panel slide
        </m.span>
        <m.span key={`r${run}`} variants={mp.revealOnce} initial="initial" animate="animate" className="inline-block text-meta text-fg-muted">
          reveal once
        </m.span>
        <m.span key={`s${run}`} variants={mp.listStagger()} initial="initial" animate="animate" className="inline-flex gap-1">
          {["list", "stagger", "items"].map((w) => (
            <m.span key={w} variants={mp.listItem} className="inline-block text-meta text-fg-muted">
              {w}
            </m.span>
          ))}
        </m.span>
        <span className="inline-flex items-center gap-2 text-meta text-fg-muted">
          <StatusDot tone="idle" running /> running (breathe)
        </span>
      </Spec>
    </>
  );
}

// ---------- components ----------

const FORCED_HOVER = { primary: "bg-accent-hover", secondary: "bg-surface border-control", ghost: "bg-surface-2 text-fg", danger: "bg-bad-bg border-bad-border", quiet: "bg-accent-subtle border-accent-border" } as const;
const FORCED_FOCUS = "outline-2 outline-offset-2 outline-focus";

function Buttons() {
  const variants = ["primary", "secondary", "ghost", "danger", "quiet"] as const;
  const labels = { primary: "Approve", secondary: "Edit", ghost: "Clear filters", danger: "Reject", quiet: "Review" };
  return (
    <>
      {variants.map((v) => (
        <Spec key={v} label={v}>
          <Button variant={v}>{labels[v]}</Button>
          <Button variant={v} className={FORCED_HOVER[v]}>
            Hover
          </Button>
          <Button variant={v} className={FORCED_FOCUS}>
            Focus
          </Button>
          <Button variant={v} disabled>
            Disabled
          </Button>
          <Button variant={v} loading loadingText="Sending…">
            {labels[v]}
          </Button>
          <Button variant={v} size="sm">
            Small
          </Button>
        </Spec>
      ))}
      <Spec label="states">
        <span className="text-meta text-fg-faint">default · hover (forced) · focus (forced) · disabled · loading · sm 28 px / md 32 px</span>
      </Spec>
    </>
  );
}

function Forms() {
  return (
    <div className="grid max-w-3xl grid-cols-2 gap-x-8 gap-y-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sg-dob">Date of birth</Label>
        <Input id="sg-dob" defaultValue="1959-12-16" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sg-ph">Member ID</Label>
        <Input id="sg-ph" placeholder="e.g. NGP448812907" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sg-bad">Date of birth (422)</Label>
        <Input id="sg-bad" defaultValue="2020-13-45" aria-invalid="true" aria-describedby="sg-bad-msg" />
        <span id="sg-bad-msg" className="text-meta text-bad">
          Not a date. Use YYYY-MM-DD.
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sg-dis">Payor (disabled)</Label>
        <Input id="sg-dis" defaultValue="Northgate Plan" disabled />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sg-ro">Order ID (read-only)</Label>
        <Input id="sg-ro" defaultValue="ORDE70F7E38" readOnly className="font-mono text-code" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Status filter</Label>
        <Select defaultValue="needs_review">
          <SelectTrigger className="w-52" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS) as ReferralStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex flex-col gap-1.5">
        <Label htmlFor="sg-ta">Reason for rejecting</Label>
        <Textarea id="sg-ta" placeholder="The coordinator reads this. Say what's missing." />
      </div>
    </div>
  );
}

function Overlays() {
  return (
    <>
      <Spec label="tabs (neutral)">
        <Tabs defaultValue="review" className="w-full max-w-xl">
          <TabsList>
            <TabsTrigger value="review">
              Needs review <span className="text-fg-faint tabular-nums">31</span>
            </TabsTrigger>
            <TabsTrigger value="errors">
              RIS errors <span className="text-fg-faint tabular-nums">3</span>
            </TabsTrigger>
            <TabsTrigger value="all">
              All <span className="text-fg-faint tabular-nums">57</span>
            </TabsTrigger>
            <TabsTrigger value="off" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="review" className="text-body text-fg-muted">
            Sample counts. Tabs replace the status select on the queue.
          </TabsContent>
          <TabsContent value="errors" className="text-body text-fg-muted">
            RIS errors tab.
          </TabsContent>
          <TabsContent value="all" className="text-body text-fg-muted">
            All referrals.
          </TabsContent>
        </Tabs>
      </Spec>
      <Spec label="kbd / badge">
        <span className="inline-flex items-center gap-1 text-meta text-fg-muted">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd> move <Kbd>↵</Kbd> open
        </span>
        <Badge>Synthetic data · no PHI</Badge>
        <Badge tone="ok">AA</Badge>
        <Badge tone="warn">2 warnings</Badge>
        <Badge tone="bad">1 error</Badge>
        <Badge tone="idle">pending</Badge>
      </Spec>
      <Spec label="tooltip / menu / popover / dialog">
        <Tip content="Received 2026-11-23 19:55">
          <Button variant="ghost" size="sm">
            Hover for tooltip
          </Button>
        </Tip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Referral</DropdownMenuLabel>
            <DropdownMenuItem>Open in pipeline graph</DropdownMenuItem>
            <DropdownMenuItem>Copy order ID</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Retry send (nothing to retry)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm">Popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <div className="text-body font-medium">Why it stopped</div>
            <p className="mt-1 text-body text-fg-muted">Coverage: member not found (271).</p>
          </PopoverContent>
        </Popover>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="danger">
              Reject…
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject this referral?</DialogTitle>
              <DialogDescription>The referring office is told why. This can't be undone from here.</DialogDescription>
            </DialogHeader>
            <Textarea placeholder="Reason (required)" />
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Reject referral</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Spec>
      <Spec label="toast">
        <Button size="sm" onClick={() => toast.success("Order sent · ACK AA", { description: "Sample. RIS accepted ORDE70F7E38." })}>
          Success
        </Button>
        <Button size="sm" onClick={() => toast.error("RIS didn't acknowledge", { description: "Sample. connection refused (127.0.0.1:2575)" })}>
          Error
        </Button>
        <Button size="sm" onClick={() => toast("Pipeline started", { description: "Sample. Following it on the graph." })}>
          Info
        </Button>
        <span className="text-meta text-fg-faint">bottom-right, above the sticky actions bar; never over the nav</span>
      </Spec>
    </>
  );
}

const TONES: StatusTone[] = ["ok", "warn", "bad", "rejected", "idle"];

function Status() {
  return (
    <>
      <Spec label="five-state set">
        <StatusPill tone="ok">Sent / approved</StatusPill>
        <StatusPill tone="warn">Needs review</StatusPill>
        <StatusPill tone="bad">Error (needs action)</StatusPill>
        <StatusPill tone="rejected">Rejected (terminal)</StatusPill>
        <StatusPill tone="idle">Pending</StatusPill>
        <StatusPill tone="idle" running>
          Processing (running)
        </StatusPill>
      </Spec>
      <Spec label="every referral status">
        {(Object.keys(STATUS) as ReferralStatus[]).map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </Spec>
      <Spec label="ACK folded in">
        <ReferralStatusPill status="sent_to_ris" ack="AA" />
        <ReferralStatusPill status="sent_to_ris" ack="AE" />
        <ReferralStatusPill status="ris_error" ack={null} />
        <ReferralStatusPill status="ris_error" ack="AR" />
        <AckBadge code="AA" />
        <AckBadge code="AE" />
        <AckBadge code={null} />
      </Spec>
      <Spec label="status line (headers)" className="flex-col items-start gap-2">
        <StatusLine tone="warn" detail="referral_013.pdf · received 19:55">
          Paused for review · 2 reasons
        </StatusLine>
        <StatusLine tone="ok" detail="Sent 19:55 · first attempt">
          Order sent · ACK AA
        </StatusLine>
        <StatusLine tone="bad" detail="connection refused (127.0.0.1:2575)" action={<Button variant="quiet" size="sm">Retry send</Button>}>
          RIS didn't acknowledge
        </StatusLine>
        <StatusLine tone="rejected" detail="by coordinator · 2026-11-23 14:05">
          Rejected: prior imaging missing
        </StatusLine>
        <StatusLine tone="idle" running detail="This page updates as it settles.">
          Extracting fields
        </StatusLine>
      </Spec>
      <Spec label={<>confidence · threshold {SAMPLE_THRESHOLD} <SampleTag /></>}>
        {[0.99, 0.85, 0.72, 0.41, null].map((v, i) => (
          <ConfidenceMeter key={i} value={v} threshold={SAMPLE_THRESHOLD} />
        ))}
        <span className="text-fg-faint">·</span>
        {[0.99, 0.72, 0.41].map((v) => (
          <ConfidenceMeter key={v} value={v} threshold={SAMPLE_THRESHOLD} bar />
        ))}
        <span className="text-fg-faint">·</span>
        <ConfidenceMeter value={0.97} threshold={SAMPLE_THRESHOLD} quiet />
        <ConfidenceMeter value={0.72} threshold={SAMPLE_THRESHOLD} quiet />
      </Spec>
      <Spec label="dots">
        {TONES.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 font-mono text-meta text-fg-faint">
            <StatusDot tone={t} /> {t}
          </span>
        ))}
      </Spec>
    </>
  );
}

// ---------- table ----------

const col = createColumnHelper<SampleReferral>();
const columns = [
  col.accessor("patient", {
    header: "Patient",
    meta: { truncate: true, skeleton: "w-40" },
    cell: (c) => (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-medium text-fg" title={c.getValue()}>
          {c.getValue()}
        </span>
        <span className="shrink-0 text-meta text-fg-faint tabular-nums">{c.row.original.dob}</span>
      </span>
    ),
  }),
  col.accessor("cpt", {
    header: "Study",
    meta: { truncate: true, skeleton: "w-48" },
    cell: (c) => (
      <span className="flex min-w-0 items-baseline gap-2" title={c.row.original.study}>
        <Code className="shrink-0 text-fg">{c.getValue()}</Code>
        <span className="truncate text-fg-muted">{c.row.original.study}</span>
      </span>
    ),
  }),
  col.accessor("payor", {
    header: "Payor",
    meta: { className: "w-44 max-w-44", skeleton: "w-24" },
    cell: (c) => (c.getValue() ? <span className="block truncate" title={c.getValue() ?? undefined}>{c.getValue()}</span> : <span className="text-fg-faint">-</span>),
  }),
  col.accessor("confidence", {
    header: "Conf.",
    meta: { numeric: true, className: "w-20", skeleton: "w-8" },
    sortUndefined: "last",
    cell: (c) => <ConfidenceMeter value={c.getValue()} threshold={SAMPLE_THRESHOLD} quiet />,
  }),
  col.accessor("status", {
    header: "Status",
    meta: { className: "w-44", skeleton: "w-24" },
    cell: (c) => <ReferralStatusPill status={c.getValue()} ack={c.row.original.ack} />,
  }),
  col.accessor("received", { header: "Received", enableSorting: false, meta: { numeric: true, className: "w-24 text-fg-muted", skeleton: "w-12" } }),
];

const quick = (r: SampleReferral) =>
  r.status === "needs_review" ? (
    <Button variant="quiet" size="sm" onClick={() => toast(`Sample: open ${r.patient}`)}>
      Review
    </Button>
  ) : r.status === "ris_error" ? (
    <Button variant="quiet" size="sm" onClick={() => toast(`Sample: retry send for ${r.patient}`)}>
      Retry send
    </Button>
  ) : null;

type TableState = "rows" | "loading" | "empty" | "error" | "one";

function TableDemo() {
  const [state, setState] = useState<TableState>("rows");
  const [selected, setSelected] = useState<string | null>("s-001");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const data = state === "empty" ? [] : state === "one" ? SAMPLE_REFERRALS.slice(0, 1) : SAMPLE_REFERRALS;
  // "rows" after a reload: show the skeleton, then let the rows resolve top to bottom
  useEffect(() => {
    if (!reload) return;
    setLoading(true);
    const t = window.setTimeout(() => setLoading(false), DURATION_MS.reveal * 2);
    return () => window.clearTimeout(t);
  }, [reload]);
  return (
    <>
      <Spec label={<>live table <SampleTag /></>}>
        <Tabs value={state} onValueChange={(v) => setState(v as TableState)}>
          <TabsList className="h-8 border-b-0">
            {(["rows", "loading", "empty", "one", "error"] as TableState[]).map((s) => (
              <TabsTrigger key={s} value={s} className="h-8">
                {s === "one" ? "1 item" : s === "empty" ? "0 items" : s}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button size="sm" variant="ghost" onClick={() => { setState("rows"); setReload((r) => r + 1); }}>
          Replay progressive fill
        </Button>
        <span className="inline-flex items-center gap-1 text-meta text-fg-muted">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd> move <Kbd>↵</Kbd> open · hover a row for its quick action
        </span>
      </Spec>
      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <DataTable
          data={data}
          columns={columns}
          getRowId={(r) => r.id}
          testId="sg-table"
          rowTestId="sg-row"
          label="Sample referrals"
          initialSorting={[{ id: "status", desc: false }]}
          loading={state === "loading" || loading}
          loadingRows={6}
          error={state === "error" ? new ApiError(500, "database is unavailable", null) : undefined}
          errorTitle="Couldn't load referrals"
          onRetry={() => setState("rows")}
          empty={<EmptyState title="No referrals yet" hint="Upload a fax to start. It shows up here once the pipeline picks it up." action={<Button size="sm" variant="primary">Upload fax</Button>} />}
          selectedId={selected}
          onSelectedChange={setSelected}
          keyboard
          onOpen={(r) => toast(`Sample: open ${r.patient}`)}
          quickAction={quick}
        />
      </div>
    </>
  );
}

// ---------- panels, code, stats ----------

function Panels() {
  return (
    <div className="max-w-2xl">
      <Accordion defaultValue="policy">
        <AccordionItem value="eligibility" title="Eligibility (270/271)" summary="Member not found">
          <KeyValue label="Payor">Northgate Plan</KeyValue>
          <KeyValue label="Member ID">
            <Code>NGP448812907</Code>
          </KeyValue>
          <KeyValue label="Response">271 · AAA*N**75 (subscriber not found)</KeyValue>
        </AccordionItem>
        <AccordionItem value="policy" title="Prior auth and policy" summary="Required · 6 citations">
          <p className="text-body text-fg-muted">Sample. Northgate Plan requires prior authorisation for CPT 74177 when no prior imaging is documented within 90 days.</p>
        </AccordionItem>
        <AccordionItem value="packet" title="Auth packet" summary="2 pages">
          <p className="text-body text-fg-muted">Sample. Cover sheet and clinical notes.</p>
        </AccordionItem>
        <AccordionItem value="order" title="HL7 order and RIS ACK" summary="Sent · ACK AA">
          <CodeViewer code={SAMPLE_HL7_ORM} format="hl7" label="ORM^O01 · sample" />
        </AccordionItem>
        <AccordionItem value="disabled" title="Corrections" summary="None yet" disabled>
          {null}
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function CodeSamples() {
  return (
    <div className="grid max-w-5xl grid-cols-2 gap-6">
      <CodeViewer code={SAMPLE_HL7_ORM} format="hl7" label="HL7 v2 ORM^O01 · sample" />
      <CodeViewer code={SAMPLE_HL7_ACK} format="hl7" label="HL7 v2 ACK · sample" lineNumbers />
      <CodeViewer className="col-span-2" code={SAMPLE_X12_270} format="x12" label="X12 270 eligibility request · sample" lineNumbers />
      <CodeViewer className="col-span-2" code={SAMPLE_HL7_ORM} format="hl7" copy={false} wrap />
    </div>
  );
}

function Stats() {
  const [hits, setHits] = useState(57);
  return (
    <>
      <Spec label={<>stat row <SampleTag /></>} className="block">
        <StatRow
          stats={[
            { id: "with", value: <><CountThrough value={hits} />/60</>, label: "right policy, with CPT", comparison: "v1: 57/60" },
            { id: "without", value: <><CountThrough value={55} />/60</>, label: "right policy, CPT removed", comparison: "v1: 48/60" },
            { id: "false", value: <CountThrough value={1} />, label: "false approval", comparison: "both pipelines" },
            { id: "cost", value: <CountThrough value={0.0145} format={(n) => `$${n.toFixed(4)}`} />, label: "per referral", comparison: "both pipelines" },
          ]}
        />
      </Spec>
      <Spec label="count-through">
        <Button size="sm" onClick={() => setHits((h) => (h === 60 ? 57 : 60))}>
          Change the first value
        </Button>
        <span className="text-meta text-fg-faint">600 ms once on first view, 200 ms through each change, final value under reduced motion</span>
      </Spec>
      <Spec label={<>v1 vs v2 bars <SampleTag /></>} className="block max-w-3xl">
        <BarComparison
          caption="Sample: v1 versus v2"
          series={[
            { key: "v1", label: "v1" },
            { key: "v2", label: "v2" },
          ]}
          rows={[
            { id: "with", label: "Right policy, with CPT", values: { v1: 57, v2: 60 }, max: 60 },
            { id: "without", label: "Right policy, CPT removed", values: { v1: 48, v2: 55 }, max: 60 },
            { id: "lat", label: "Pipeline latency p50", values: { v1: 0.4, v2: 57 }, display: { v1: "0.4 ms", v2: "57 ms" } },
            { id: "none", label: "A row with no v1 data", values: { v1: null, v2: 12 }, max: 60 },
          ]}
        />
      </Spec>
    </>
  );
}

function Split() {
  return (
    <div className="h-48 max-w-3xl overflow-hidden rounded-md border border-border">
      <SplitPane
        label="Resize the sample panes"
        left={<div className="flex h-full items-center justify-center bg-surface text-meta text-fg-muted">Fax (sample)</div>}
        right={<div className="flex h-full items-center justify-center text-meta text-fg-muted">Fields · drag the line, or focus it and use ← →</div>}
      />
    </div>
  );
}

function States() {
  return (
    <div className="grid max-w-5xl grid-cols-2 gap-x-8">
      <div className="border-b border-border">
        <div className="text-meta text-fg-faint">Empty</div>
        <EmptyState title="No referrals yet" hint="Upload a fax to start. It shows up here once the pipeline picks it up." action={<Button size="sm">Upload fax</Button>} />
      </div>
      <div className="border-b border-border">
        <div className="text-meta text-fg-faint">Error: API down (500)</div>
        <ErrorState title="Couldn't load referrals" error={new ApiError(500, "database is unavailable", null)} onRetry={() => toast("Sample retry")} />
      </div>
      <div className="border-b border-border">
        <div className="text-meta text-fg-faint">Error: network</div>
        <ErrorState title="Couldn't load the benchmark" error={new TypeError("Failed to fetch")} onRetry={() => toast("Sample retry")} />
      </div>
      <div className="border-b border-border">
        <div className="text-meta text-fg-faint">Error: 404, no title</div>
        <ErrorState error={new ApiError(404, "referral not found", null)} />
      </div>
      <div className="col-span-2 pt-6">
        <div className="mb-2 text-meta text-fg-faint">Loading rows (skeleton, breathing; rows appear top to bottom once)</div>
        <LoadingRows rows={4} />
      </div>
      <div className="col-span-2 flex items-center gap-3 pt-6">
        <span className="text-meta text-fg-faint">Skeleton</span>
        <Skeleton className="h-2.5 w-40" />
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="max-w-5xl rounded-md border border-border">
      <PageHeader
        eyebrow={<Link to="/__styleguide#header" className="hover:text-fg">← Queue</Link>}
        title="Vanderbilt-Ashworthington, Maximiliana Josephine"
        status={
          <StatusLine tone="warn" detail="referral_013.pdf · received 19:55">
            Paused for review · 2 reasons
          </StatusLine>
        }
        actions={
          <>
            <Button variant="danger">Reject</Button>
            <Button>Edit</Button>
            <Button variant="primary">Approve</Button>
          </>
        }
        divider={false}
      />
      <div className="border-t border-border">
        <PageHeader title="31 referrals need review" meta="57 received today · 19 sent to RIS · 3 RIS errors · 4 rejected (sample)" actions={<Button variant="primary">Upload fax</Button>} divider={false} />
      </div>
    </div>
  );
}

function HighlightDemo() {
  const hl = useTravelingHighlight<HTMLUListElement>();
  return (
    <ul ref={hl.container.ref} onPointerLeave={hl.container.onPointerLeave} className="relative flex w-56 flex-col gap-0.5">
      <TravelingHighlight state={hl.state} className="rounded-md" />
      {["Queue", "Pipeline", "Evals", "RIS orders"].map((l) => (
        <li key={l} {...hl.item} className="relative flex h-8 items-center rounded-md px-2 text-body text-fg-muted">
          {l}
        </li>
      ))}
    </ul>
  );
}

// ---------- page ----------

export default function StyleguidePage() {
  const toc = useMemo(() => SECTIONS, []);
  return (
    <div className="min-h-full pb-16" data-testid="styleguide">
      <PageHeader
        eyebrow="Design system · /__styleguide"
        title="Referral Intake styleguide"
        meta="Tokens and base components in every state. Values marked Sample are static examples; the screens read every number from the API."
        actions={<ThemeToggle withLabels />}
      />
      <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 px-6 py-3 text-meta">
        {toc.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-fg-muted hover:text-fg">
            {label}
          </a>
        ))}
      </nav>
      <Section id="colour" title="Colour" intro="Cool neutrals carry the structure. Teal means act on this. Status colour sits on the status only.">
        <Colour />
      </Section>
      <Section id="contrast" title="Contrast" intro="AA in both themes: 4.5:1 for text, 3:1 for controls, focus, status dots and chart marks.">
        <Contrast />
      </Section>
      <Section id="type" title="Type" intro="Inter for the interface, JetBrains Mono for codes only. One display size, three text sizes.">
        <Type />
      </Section>
      <Section id="space" title="Space and shape">
        <Space />
      </Section>
      <Section id="motion" title="Motion" intro="Motion explains change. Under reduced motion every animation is a fade.">
        <Motion />
        <Spec label="traveling highlight">
          <HighlightDemo />
        </Spec>
      </Section>
      <Section id="buttons" title="Buttons" intro="Teal only for the one primary action and the row quick action (quiet).">
        <Buttons />
      </Section>
      <Section id="forms" title="Form controls">
        <Forms />
      </Section>
      <Section id="overlays" title="Tabs, menus, overlays">
        <Overlays />
      </Section>
      <Section id="status" title="Status" intro="A dot plus a label. Errors read in red; rejected is a muted terminal state; pending is a hollow ring.">
        <Status />
      </Section>
      <Section id="table" title="Data table" intro="40 px rows on hairlines, sticky header, right-aligned numbers, a neutral selection and one quiet action per row.">
        <TableDemo />
      </Section>
      <Section id="panels" title="Accordion" intro="One panel open at a time; each header keeps its summary on the right (320 ms).">
        <Panels />
      </Section>
      <Section id="code" title="Code viewer" intro="HL7 v2 split on \r and X12 split on ~; the segment id leads, separators are faint.">
        <CodeSamples />
      </Section>
      <Section id="stats" title="Stats and bars" intro="Every number has a label. Bars use two neutral shades; colour never says better or worse.">
        <Stats />
      </Section>
      <Section id="split" title="Split pane">
        <Split />
      </Section>
      <Section id="states" title="States" intro="Plain-language copy, the technical detail underneath, and no icon circles.">
        <States />
      </Section>
      <Section id="header" title="Page header" intro="The display line is a sentence; one quiet status line replaces filled banners.">
        <Header />
      </Section>
      <Section id="morph" title="Shared element (row → detail)" intro="Click a row: its name grows into the detail header (320 ms). Back reverses it. Off under reduced motion.">
        <MorphDemo />
        <Spec label="across routes">
          <MorphRouteList />
        </Spec>
      </Section>
    </div>
  );
}
