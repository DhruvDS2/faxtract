import { useEffect, useRef, useState } from "react";
import { approve, Box, correct, getReferral, pageCount, pageUrl, ProcessedReferral, reject } from "./api";
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

  // Hover wins while the pointer is over a field; otherwise the highlight stays
  // on whatever was last focused or revealed, so it holds while you type a
  // correction and returns to that field once the pointer moves away.
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const active = hovered ?? focused;

  // Set when a reveal has to change page first; the scroll happens on img load.
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => { getReferral(id).then(setData); }, [id]);
  useEffect(() => {
    pageCount(id).then((r) => { setPages(r.count); setPage(Math.max(0, r.count - 1)); });
  }, [id]);

  if (!data) return <p>Loading…</p>;

  const flagsFor = (field: string) => data.flags.filter((f) => f.field === field);
  const boxesFor = (field: string): Box[] => data.referral.boxes?.[field] ?? [];

  const scrollToBox = (box: Box) => {
    const container = scrollRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    // Box coordinates are fractions of the rendered image, so they survive zoom.
    const centerX = (box.left + box.width / 2) * img.clientWidth;
    const centerY = (box.top + box.height / 2) * img.clientHeight;
    container.scrollTo({
      left: centerX - container.clientWidth / 2,
      top: centerY - container.clientHeight / 2,
      behavior: "smooth",
    });
  };

  /** Jump the viewer to where this field was read from. */
  const reveal = (field: string) => {
    const [box] = boxesFor(field);
    if (!box) return;
    setFocused(field);
    if (box.page !== page) {
      setPage(box.page);
      setPendingScroll(field);   // the new page has to load before we can scroll
    } else {
      scrollToBox(box);
    }
  };

  const onImageLoad = () => {
    if (!pendingScroll) return;
    const [box] = boxesFor(pendingScroll);
    if (box) scrollToBox(box);
    setPendingScroll(null);
  };

  const save = async () => {
    if (Object.keys(edits).length) setData(await correct(id, edits));
    setEdits({});
  };

  const highlights = active ? boxesFor(active).filter((b) => b.page === page) : [];

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
            {active && (
              <span style={{ fontSize: 12, color: "#a60", marginLeft: 12 }}>
                {highlights.length > 0
                  ? `showing source of ${active}`
                  : boxesFor(active).length > 0
                    ? `${active} was read from page ${boxesFor(active)[0].page + 1}`
                    : `no source region for ${active}`}
              </span>
            )}
          </div>
          <div ref={scrollRef} style={{ border: "1px solid #ddd", height: 640, overflow: "auto", background: "#333" }}>
            {/* Wrapper carries the zoom so the overlay and the image scale together. */}
            <div style={{ position: "relative", width: `${zoom * 100}%` }}>
              <img
                ref={imgRef}
                src={pageUrl(id, page)}
                alt="fax page"
                onLoad={onImageLoad}
                style={{ width: "100%", display: "block" }}
              />
              {highlights.map((box, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${box.left * 100}%`,
                    top: `${box.top * 100}%`,
                    width: `${box.width * 100}%`,
                    height: `${box.height * 100}%`,
                    border: "2px solid #e0a030",
                    background: "rgba(224, 160, 48, 0.22)",
                    borderRadius: 2,
                    pointerEvents: "none",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <div>
          {Object.entries(data.referral)
            .filter(([k]) => k !== "confidence" && k !== "boxes")
            .map(([field, value]) => {
              const conf = data.referral.confidence?.[field];
              const low = conf !== undefined && conf < THRESHOLD;
              const hasSource = boxesFor(field).length > 0;
              const isActive = active === field;
              return (
                <div
                  key={field}
                  style={{ marginBottom: 10 }}
                  onMouseEnter={() => setHovered(field)}
                  onMouseLeave={() => setHovered((h) => (h === field ? null : h))}
                >
                  <label style={{ fontSize: 12, color: "#555" }}>
                    {field} {conf !== undefined && <span>({conf.toFixed(2)})</span>}
                    {hasSource && (
                      <button
                        onClick={() => reveal(field)}
                        title="Show where this was read from"
                        style={{
                          marginLeft: 6, padding: "0 5px", fontSize: 11, lineHeight: "16px",
                          cursor: "pointer", border: "1px solid #bbb", borderRadius: 3,
                          background: isActive ? "#e0a030" : "#f4f4f4",
                          color: isActive ? "white" : "#444",
                        }}
                      >
                        ⌖
                      </button>
                    )}
                  </label>
                  <input
                    value={edits[field] ?? (Array.isArray(value) ? value.join(", ") : value ?? "")}
                    onChange={(e) => setEdits({ ...edits, [field]: e.target.value })}
                    onFocus={() => setFocused(field)}
                    onBlur={() => setFocused((f) => (f === field ? null : f))}
                    style={{
                      width: "100%", padding: 6,
                      background: low ? "#fff6e0" : "white",
                      border: `1px solid ${isActive ? "#e0a030" : low ? "#e0a030" : "#ccc"}`,
                      outline: isActive ? "2px solid rgba(224,160,48,0.35)" : "none",
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
