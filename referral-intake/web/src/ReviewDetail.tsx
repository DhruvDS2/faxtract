import { useEffect, useState } from "react";
import { approve, correct, getReferral, pageCount, pageUrl, ProcessedReferral, reject } from "./api";

const THRESHOLD = 0.85;

export default function ReviewDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<ProcessedReferral | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);

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
    </div>
  );
}
