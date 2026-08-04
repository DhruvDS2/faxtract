import { useEffect, useState } from "react";
import { listReferrals, ProcessedReferral, uploadReferral } from "./api";
import QueueTable from "./QueueTable";
import ReviewDetail from "./ReviewDetail";

export default function App() {
  const [referrals, setReferrals] = useState<ProcessedReferral[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = () => listReferrals().then(setReferrals);
  useEffect(() => { refresh(); }, []);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadReferral(file);
      await refresh();
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Referral Intake</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        All data is synthetic. No real patient information is used anywhere in this system.
      </p>
      {!selected && (
        <div style={{ margin: "12px 0", padding: 12, background: "#f5f7fa", borderRadius: 6 }}>
          <label style={{ fontSize: 14 }}>
            Upload a faxed referral (PDF):{" "}
            <input type="file" accept="application/pdf" onChange={onUpload} disabled={uploading} />
          </label>
          {uploading && <span style={{ marginLeft: 10, color: "#a60" }}>Claude is reading the fax…</span>}
          <button onClick={refresh} style={{ marginLeft: 12 }}>Refresh</button>
        </div>
      )}
      {selected
        ? <ReviewDetail id={selected} onBack={() => { setSelected(null); refresh(); }} />
        : <QueueTable referrals={referrals} onSelect={setSelected} />}
    </div>
  );
}
