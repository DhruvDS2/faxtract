import { useEffect, useMemo, useRef, useState } from "react";
import type { Box, ProcessedReferral } from "../api";
import { approve, correct, getReferral, pageCount, reject } from "../api";
import { labelFor } from "../lib/fields";
import { ELIGIBILITY_LABELS, STATUS_LABELS, isLow, liveFlags, patientName } from "../lib/format";
import { useHotkeys } from "../lib/useHotkeys";
import EvidenceTabs from "./EvidenceTabs";
import FaxViewer from "./FaxViewer";
import FieldsPanel, { type FocusRequest } from "./FieldsPanel";
import { Spinner } from "./ui/Icons";
import { Status, type Tone } from "./ui/Signal";
import { toast } from "./ui/Toast";

const ELIGIBILITY_TONES: Record<string, Tone> = {
  active_in_network: "good",
  active_out_of_network: "warn",
  terminated: "bad",
  not_found: "bad",
};

/** Everything a reviewer needs to judge the referral before reading a field. */
function Header({ data }: { data: ProcessedReferral }) {
  const r = data.referral;
  const { auth, eligibility } = data;
  const meta = [r.requested_study, r.cpt_code, r.laterality !== "n/a" ? r.laterality : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="shrink-0 px-5 pb-3 pt-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{patientName(r)}</h2>
        {r.urgency && r.urgency !== "routine" && (
          <span className={r.urgency === "stat" ? "text-[12px] text-red" : "text-[12px] text-amber"}>
            {r.urgency === "stat" ? "Stat" : "Urgent"}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[12px] text-muted">{STATUS_LABELS[data.status] ?? data.status}</span>
      </div>

      {meta && <p className="mt-0.5 text-[12.5px] text-muted">{meta}</p>}

      {(eligibility || auth) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          {eligibility && (
            <Status tone={ELIGIBILITY_TONES[eligibility.status] ?? "neutral"}>
              {ELIGIBILITY_LABELS[eligibility.status] ?? eligibility.status}
              {eligibility.plan_name && (
                <span className="text-faint">· {eligibility.plan_name}</span>
              )}
            </Status>
          )}
          {auth && (
            <Status tone={auth.required ? (auth.missing_elements.length ? "warn" : "neutral") : "neutral"}>
              {auth.required
                ? auth.missing_elements.length
                  ? `Auth required · missing ${auth.missing_elements.join(", ").replace(/_/g, " ")}`
                  : "Auth required"
                : "No auth needed"}
            </Status>
          )}
        </div>
      )}
    </header>
  );
}

export default function ReviewPane({
  id,
  onDecided,
  onChanged,
}: {
  id: string;
  onDecided: () => void;
  onChanged: (updated: ProcessedReferral) => void;
}) {
  const [data, setData] = useState<ProcessedReferral | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>(null);
  const [reveal, setReveal] = useState<{ field: string; nonce: number } | null>(null);
  const nonce = useRef(0);

  useEffect(() => {
    setData(null);
    setEdits({});
    setActiveField(null);
    setReveal(null);
    getReferral(id).then(setData);
    pageCount(id).then((r) => {
      setPages(Math.max(1, r.count));
      setPage(0);
    });
  }, [id]);

  const boxes: Box[] = useMemo(() => {
    const field = activeField ?? reveal?.field;
    if (!field || !data) return [];
    return data.referral.boxes?.[field] ?? [];
  }, [activeField, reveal, data]);

  /** Fields that still need a human: failed validation, or below threshold. */
  const unresolved = useMemo(() => {
    if (!data) return [];
    const flagged = liveFlags(data.flags, data.referral.confidence).map((f) => f.field);
    const low = Object.entries(data.referral.confidence ?? {})
      .filter(([, c]) => isLow(c))
      .map(([f]) => f);
    return [...new Set([...flagged, ...low])].filter((f) => f in data.referral);
  }, [data]);

  const onReveal = (field: string) => {
    setActiveField(field);
    setReveal({ field, nonce: ++nonce.current });
  };

  const nextUnresolved = () => {
    if (!unresolved.length) {
      toast("Nothing left to check on this referral", "good");
      return;
    }
    const current = focusRequest?.field;
    const index = current ? unresolved.indexOf(current) : -1;
    const field = unresolved[(index + 1) % unresolved.length];
    setFocusRequest({ field, nonce: ++nonce.current });
    onReveal(field);
  };

  const save = async () => {
    if (!Object.keys(edits).length) return;
    setSaving(true);
    try {
      const updated = await correct(id, edits);
      setData(updated);
      onChanged(updated);
      setEdits({});
      toast(`Saved ${Object.keys(edits).length} correction(s)`, "good");
    } catch {
      toast("Could not save corrections", "bad");
    } finally {
      setSaving(false);
    }
  };

  const decide = async (action: "approve" | "reject") => {
    if (!data) return;
    setDeciding(true);
    try {
      // Unsaved edits would be silently dropped by a decision, so land them first.
      if (Object.keys(edits).length) {
        const updated = await correct(id, edits);
        setData(updated);
        setEdits({});
      }
      if (action === "approve") {
        const res = await approve(id);
        toast(
          res.sent
            ? `${patientName(data.referral)} sent to the RIS`
            : `${patientName(data.referral)} approved, but the RIS did not acknowledge`,
          res.sent ? "good" : "bad",
        );
      } else {
        await reject(id);
        toast(`${patientName(data.referral)} rejected`);
      }
      onDecided();
    } catch {
      toast(`Could not ${action} this referral`, "bad");
    } finally {
      setDeciding(false);
    }
  };

  useHotkeys([
    { key: "f", run: nextUnresolved },
    { key: "[", run: () => setPage((p) => Math.max(0, p - 1)) },
    { key: "]", run: () => setPage((p) => Math.min(pages - 1, p + 1)) },
    { key: "s", meta: true, whileTyping: true, run: save },
    { key: "enter", meta: true, whileTyping: true, run: () => decide("approve") },
    { key: "backspace", meta: true, whileTyping: true, run: () => decide("reject") },
  ]);

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={16} className="text-faint" />
      </div>
    );
  }

  const errorFields = liveFlags(data.flags, data.referral.confidence)
    .filter((f) => f.severity === "error")
    .map((f) => f.field);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Header data={data} />

      {errorFields.length > 0 && (
        <button
          onClick={nextUnresolved}
          className="mx-5 mb-2 shrink-0 self-start text-left text-[12px] text-red hover:underline"
        >
          {errorFields.map(labelFor).join(", ")} failed validation
        </button>
      )}

      {/* Side by side when there is room; stacked once the evidence column
          would be crushed, so neither pane ever overlaps the other. */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,auto)] xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-1">
        <EvidenceTabs
          data={data}
          fax={
            <FaxViewer
              id={id}
              page={page}
              pages={pages}
              onPage={setPage}
              activeField={activeField}
              boxes={boxes}
              revealNonce={reveal?.nonce ?? 0}
            />
          }
        />
        <div className="min-h-0 border-t border-border xl:border-l xl:border-t-0">
          <FieldsPanel
            data={data}
            edits={edits}
            activeField={activeField}
            focusRequest={focusRequest}
            saving={saving}
            deciding={deciding}
            onEdit={(field, value) => setEdits((e) => ({ ...e, [field]: value }))}
            onActiveField={setActiveField}
            onReveal={onReveal}
            onSave={save}
            onApprove={() => decide("approve")}
            onReject={() => decide("reject")}
          />
        </div>
      </div>
    </div>
  );
}
