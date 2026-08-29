import { Button } from "./ui/Button";
import { Kbd } from "./ui/Kbd";

const STEPS = [
  "Every field is read off the scan with a confidence score.",
  "NPI, CPT, ICD-10 and member ID are checked against the catalogues.",
  "Coverage is confirmed with the payor over X12 270/271.",
  "Payor policy decides whether prior auth is needed, and cites why.",
  "Approving sends an HL7 order to the RIS.",
];

export default function WelcomePane({
  hasReferrals,
  onUpload,
}: {
  hasReferrals: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center overflow-y-auto p-10">
      <div className="w-full max-w-[420px]">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em]">
          {hasReferrals ? "Select a referral" : "Upload a fax to begin"}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {hasReferrals
            ? "The queue is ordered worst-confidence first, so whatever most needs you sits at the top."
            : "Drop a faxed referral PDF onto the queue. It runs the whole pipeline and arrives ready to review."}
        </p>

        {!hasReferrals && (
          <Button variant="primary" className="mt-5" onClick={onUpload}>
            Upload a fax
          </Button>
        )}

        <ol className="mt-9 space-y-2.5">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed text-muted">
              <span className="nums w-3 shrink-0 text-faint">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>

        <p className="mt-9 text-[12.5px] leading-relaxed text-muted">
          Press <Kbd>F</Kbd> during review to walk only the fields the model was unsure about. Each
          jump scrolls the scan to the exact spot the value was read from.
        </p>
      </div>
    </div>
  );
}
