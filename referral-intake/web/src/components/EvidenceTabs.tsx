import { useEffect, useState, type ReactNode } from "react";
import type { ProcessedReferral } from "../api";
import { cn } from "../lib/cn";
import { useHotkeys } from "../lib/useHotkeys";
import { OrderPanel, PacketPanel, PolicyPanel } from "./EvidencePanels";

type TabKey = "fax" | "policy" | "packet" | "order";

const TABS: { key: TabKey; label: string }[] = [
  { key: "fax", label: "Fax" },
  { key: "policy", label: "Policy" },
  { key: "packet", label: "Packet" },
  { key: "order", label: "Order" },
];

/**
 * The evidence column. Everything the pipeline produced sits one keystroke
 * away, and the fax stays mounted behind the other tabs so its zoom and scroll
 * position survive a round trip.
 */
export default function EvidenceTabs({
  data,
  fax,
}: {
  data: ProcessedReferral;
  fax: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("fax");
  const authRequired = !!data.auth?.required;

  useEffect(() => setTab("fax"), [data.id]);
  useHotkeys(TABS.map((t, i) => ({ key: String(i + 1), run: () => setTab(t.key) })));

  return (
    <div className="flex min-w-0 flex-col">
      <div role="tablist" className="flex shrink-0 items-center gap-5 px-5 pt-3">
        {TABS.map(({ key, label }) => {
          const selected = tab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={cn(
                "relative pb-2 text-[13px] transition-colors duration-75",
                selected ? "font-medium text-fg" : "text-faint hover:text-muted",
              )}
            >
              {label}
              {selected && <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />}
            </button>
          );
        })}
      </div>
      <div className="h-px shrink-0 bg-border" />

      <div className="relative min-h-0 flex-1">
        {/* Kept mounted: remounting would reset zoom and scroll on every switch. */}
        <div className={cn("absolute inset-0", tab !== "fax" && "invisible")}>{fax}</div>
        {tab === "policy" && (
          <div className="absolute inset-0">
            <PolicyPanel id={data.id} authRequired={authRequired} />
          </div>
        )}
        {tab === "packet" && (
          <div className="absolute inset-0">
            <PacketPanel id={data.id} authRequired={authRequired} />
          </div>
        )}
        {tab === "order" && (
          <div className="absolute inset-0">
            <OrderPanel id={data.id} referral={data} />
          </div>
        )}
      </div>
    </div>
  );
}
