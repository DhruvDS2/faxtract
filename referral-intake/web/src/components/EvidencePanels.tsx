import { useEffect, useState } from "react";
import type { PolicyResult, ProcessedReferral } from "../api";
import { getOrder, getPolicy, packetUrl } from "../api";
import { Button } from "./ui/Button";
import { Spinner } from "./ui/Icons";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-10 text-center">
      <div className="max-w-[300px]">{children}</div>
    </div>
  );
}

const Loading = ({ label }: { label: string }) => (
  <Centered>
    <Spinner size={16} className="mx-auto text-faint" />
    <p className="mt-2.5 text-[12.5px] text-muted">{label}</p>
  </Centered>
);

/** A failed stage has to read as failed — never as an empty but valid result. */
const StageError = ({ title, body }: { title: string; body: string }) => (
  <Centered>
    <p className="text-[13px] font-medium text-red">{title}</p>
    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{body}</p>
  </Centered>
);

export const NoAuthNeeded = () => (
  <Centered>
    <p className="text-[13px] font-medium">Prior authorization not required</p>
    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
      No auth is needed under this plan, so there is no policy lookup and no packet. Approving
      sends the order straight to the RIS.
    </p>
  </Centered>
);

export function PolicyPanel({ id, authRequired }: { id: string; authRequired: boolean }) {
  const [data, setData] = useState<PolicyResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    setFailed(false);
    if (authRequired) getPolicy(id).then(setData).catch(() => setFailed(true));
  }, [id, authRequired]);

  if (!authRequired) return <NoAuthNeeded />;
  if (failed)
    return (
      <StageError
        title="Policy retrieval failed"
        body="The server could not run the policy search. Auth is still required — check the API logs before approving."
      />
    );
  if (!data) return <Loading label="Retrieving payor policy" />;
  if (data.required === false) return <NoAuthNeeded />;

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-2xl">
        <p className="text-[12px] text-faint">Retrieval terms</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          {data.keywords?.length
            ? data.keywords.join(" · ")
            : "No terms were derived for this referral."}
        </p>

        <p className="mt-7 text-[12px] text-faint">Matched passages</p>
        <div className="mt-2 space-y-5">
          {data.citations.map((c, i) => (
            <article key={i}>
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="truncate text-[12.5px] font-medium">{c.source}</h4>
                <span className="nums shrink-0 text-[12px] text-faint">{c.score.toFixed(3)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                {c.text}
              </p>
            </article>
          ))}
          {!data.citations.length && (
            <p className="text-[12.5px] text-faint">No policy passages matched.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function PacketPanel({ id, authRequired }: { id: string; authRequired: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [url, setUrl] = useState<string | null>(null);

  // Fetched rather than pointed at directly: a 5xx in an iframe renders the
  // server's error page, which reads like a broken packet instead of a failure.
  useEffect(() => {
    if (!authRequired) return;
    let objectUrl: string | null = null;
    setState("loading");
    fetch(packetUrl(id))
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState("ready");
      })
      .catch(() => setState("failed"));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, authRequired]);

  if (!authRequired) return <NoAuthNeeded />;
  if (state === "loading") return <Loading label="Assembling the packet" />;
  if (state === "failed")
    return (
      <StageError
        title="Packet could not be built"
        body="The packet cites the retrieved policy, so a failed policy lookup stops it here too."
      />
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-end px-2">
        <a href={url ?? undefined} target="_blank" rel="noreferrer">
          <Button variant="quiet">Open PDF</Button>
        </a>
      </div>
      <iframe
        title="Prior authorization packet"
        src={url ?? undefined}
        className="min-h-0 flex-1 bg-subtle"
      />
    </div>
  );
}

/** HL7 is pipe-delimited and unreadable in bulk; split it into labelled segments. */
export function OrderPanel({ id, referral }: { id: string; referral: ProcessedReferral }) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMessage(null);
    setFailed(false);
    getOrder(id)
      .then((r) => setMessage(r.message))
      .catch(() => setFailed(true));
  }, [id]);

  if (failed)
    return (
      <StageError
        title="Order could not be built"
        body="The server failed while building the HL7 message for this referral."
      />
    );
  if (message === null) return <Loading label="Building HL7 ORM^O01" />;

  const segments = message.split(/[\r\n]+/).filter(Boolean);
  const sent = referral.status === "sent_to_ris";

  const copy = () => {
    navigator.clipboard?.writeText(message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 px-4">
        <span className="text-[12px] text-faint">
          ORM^O01 · {sent ? "accepted by the RIS" : "not sent yet"}
        </span>
        <div className="flex-1" />
        <Button variant="quiet" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <div className="mx-auto max-w-3xl space-y-1.5">
          {segments.map((segment, i) => (
            <div key={i} className="flex gap-3 font-mono text-[12px]">
              <span className="w-8 shrink-0 text-faint">{segment.slice(0, 3)}</span>
              <span className="min-w-0 break-all text-muted">{segment.slice(4)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
