import { useEffect, useState } from "react";
import {
  approve, Citation, correct, getOrder, getPolicy, getReferral,
  packetUrl, pageCount, pageUrl, ProcessedReferral, reject,
} from "./api";

const THRESHOLD = 0.85;

function NotRequired() {
  return (
    <div style={{ padding: 16, background: "#f0f6f0", border: "1px solid #cfe0cf", borderRadius: 6, fontSize: 14 }}>
      ✅ <b>Prior authorization not required</b> for this study under this plan — so there's no policy
      lookup or auth packet. The order goes straight to the RIS.
    </div>
  );
}

function PolicyPanel({ id }: { id: string }) {
  const [d, setD] = useState<{ required?: boolean; keywords: string[]; citations: Citation[] } | null>(null);
  useEffect(() => { getPolicy(id).then(setD); }, [id]);
  if (!d) return <p>Retrieving policy (3-step RAG)…</p>;
  if (d.required === false) return <NotRequired />;
  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <b>Step-2 keywords the RAG learned:</b>{" "}
        {d.keywords?.length ? d.keywords.join(", ") : "—"}
      </div>
      {d.citations.map((c, i) => (
        <div key={i} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
            {c.source} · score {c.score}
          </div>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0, fontSize: 13 }}>{c.text}</pre>
        </div>
      ))}
    </div>
  );
}

function OrderPanel({ id }: { id: string }) {
  const [msg, setMsg] = useState("");
  useEffect(() => { getOrder(id).then((r) => setMsg(r.message)); }, [id]);
  return (
    <pre style={{ background: "#0d1117", color: "#c9d1d9", padding: 12, overflow: "auto", fontSize: 12 }}>
      {msg || "Building HL7 ORM^O01…"}
    </pre>
  );
}

export default function ReviewDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<ProcessedReferral | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<"policy" | "packet" | "order">("policy");

  useEffect(() => { getReferral(id).then(setData); }, [id]);
  useEffect(() => {
    pageCount(id).then((r) => { setPages(r.count); setPage(Math.max(0, r.count - 1)); });
  }, [id]);

  if (!data) return <p>Loading…</p>;

  const flagsFor = (field: string) => data.flags.filter((f) => f.field === field);

  const save = async () => {
    if (Object.keys(edits).length) setData(await correct(id, edits));
    setEdits({});
  };

  return (
    <div>
      <button onClick={onBack}>← Queue</button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 16 }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}>◀</button>
            <span style={{ fontSize: 13 }}>page {page + 1} / {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>▶</button>
            <span style={{ marginLeft: 16 }} />
            <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
            <span style={{ fontSize: 13 }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>+</button>
          </div>
          <div style={{ border: "1px solid #ddd", height: 640, overflow: "auto", background: "#333" }}>
            <img
              src={pageUrl(id, page)}
              alt="fax page"
              style={{ width: `${zoom * 100}%`, display: "block" }}
            />
          </div>
        </div>
        <div>
          {Object.entries(data.referral).filter(([k]) => k !== "confidence").map(([field, value]) => {
            const conf = data.referral.confidence?.[field];
            const low = conf !== undefined && conf < THRESHOLD;
            return (
              <div key={field} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12, color: "#555" }}>
                  {field} {conf !== undefined && <span>({conf.toFixed(2)})</span>}
                </label>
                <input
                  value={edits[field] ?? (Array.isArray(value) ? value.join(", ") : value ?? "")}
                  onChange={(e) => setEdits({ ...edits, [field]: e.target.value })}
                  style={{
                    width: "100%", padding: 6,
                    background: low ? "#fff6e0" : "white",
                    border: `1px solid ${low ? "#e0a030" : "#ccc"}`,
                  }}
                />
                {flagsFor(field).map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: f.severity === "error" ? "#b00" : "#a60" }}>
                    {f.message}
                  </div>
                ))}
              </div>
            );
          })}
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button onClick={save}>Save corrections</button>
            <button onClick={() => approve(id).then(onBack)}>Approve → RIS</button>
            <button onClick={() => reject(id).then(onBack)}>Reject</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #ddd", marginBottom: 12 }}>
          {([
            ["policy", "🏥 Insurance Policy Docs"],
            ["packet", "📄 Prior Auth Packet"],
            ["order", "🩺 RIS Order (HL7)"],
          ] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "6px 12px", border: "none", cursor: "pointer",
                background: tab === t ? "#eef2f8" : "transparent",
                borderBottom: tab === t ? "2px solid #3366cc" : "2px solid transparent",
                fontWeight: tab === t ? 700 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "policy" && <PolicyPanel id={id} />}
        {tab === "packet" && (
          data.auth?.required === false ? <NotRequired /> : (
            <iframe
              title="prior-auth-packet"
              src={packetUrl(id)}
              style={{ width: "100%", height: 700, border: "1px solid #ddd" }}
            />
          )
        )}
        {tab === "order" && <OrderPanel id={id} />}
      </div>
    </div>
  );
}
