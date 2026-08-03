import { useEffect, useState } from "react";
import { listReferrals, ProcessedReferral } from "./api";
import QueueTable from "./QueueTable";
import ReviewDetail from "./ReviewDetail";

export default function App() {
  const [referrals, setReferrals] = useState<ProcessedReferral[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = () => listReferrals().then(setReferrals);
  useEffect(() => { refresh(); }, []);

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Referral Intake</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        All data is synthetic. No real patient information is used anywhere in this system.
      </p>
      {selected
        ? <ReviewDetail id={selected} onBack={() => { setSelected(null); refresh(); }} />
        : <QueueTable referrals={referrals} onSelect={setSelected} />}
    </div>
  );
}
