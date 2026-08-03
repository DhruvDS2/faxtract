import { ProcessedReferral } from "./api";

const minConfidence = (r: ProcessedReferral) => {
  const values = Object.values(r.referral.confidence || {});
  return values.length ? Math.min(...values) : 1;
};

export default function QueueTable({
  referrals,
  onSelect,
}: {
  referrals: ProcessedReferral[];
  onSelect: (id: string) => void;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
          <th>Patient</th><th>Study</th><th>Payor</th><th>Eligibility</th>
          <th>Flags</th><th>Min conf</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {referrals.map((r) => (
          <tr key={r.id} onClick={() => onSelect(r.id)}
              style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}>
            <td>{r.referral.patient_last_name}, {r.referral.patient_first_name}</td>
            <td>{r.referral.requested_study}</td>
            <td>{r.referral.payor_name}</td>
            <td>{r.eligibility?.status ?? "-"}</td>
            <td style={{ color: r.flags.some((f) => f.severity === "error") ? "#b00" : "#a60" }}>
              {r.flags.length}
            </td>
            <td>{minConfidence(r).toFixed(2)}</td>
            <td>{r.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
