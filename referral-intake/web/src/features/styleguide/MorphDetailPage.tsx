import { Link } from "react-router-dom";
import { Code } from "@/components/Code";
import { KeyValue, PageHeader } from "@/components/PageHeader";
import { Morph } from "@/components/Morph";
import { StatusLine } from "@/components/StatusLine";
import { Button } from "@/components/ui/button";
import { referralLayoutId } from "@/lib/motion";
import { statusText } from "@/lib/status";
import { SAMPLE_REFERRALS } from "./samples";

/** Target of the cross-route morph demo: the detail header grows from the clicked row. */
export function MorphDetailPage({ id }: { id: string }) {
  const r = SAMPLE_REFERRALS.find((x) => x.id === id);
  if (!r) return <PageHeader title="No such sample" eyebrow={<Link to="/__styleguide">← Styleguide</Link>} />;
  const s = statusText(r.status, r.ack);
  return (
    <div data-testid="morph-detail">
      <PageHeader
        eyebrow={
          <Link to="/__styleguide#morph" className="hover:text-fg" data-testid="morph-detail-back">
            ← Styleguide
          </Link>
        }
        title={
          <Morph layoutId={referralLayoutId(r.id)} as="span" className="max-w-full truncate align-top">
            {r.patient}
          </Morph>
        }
        status={
          <StatusLine tone={s.tone} detail="sample · cross-route shared element">
            {s.label}
          </StatusLine>
        }
        actions={<Button variant="primary">Approve</Button>}
      />
      <div className="max-w-2xl px-6 py-6">
        <KeyValue label="Date of birth">{r.dob}</KeyValue>
        <KeyValue label="Study">
          <Code>{r.cpt}</Code> {r.study}
        </KeyValue>
        <KeyValue label="Payor">{r.payor ?? "-"}</KeyValue>
      </div>
    </div>
  );
}
