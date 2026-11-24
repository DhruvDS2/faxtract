import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Document, Page } from "./pdf";

const LETTER = 11 / 8.5;
const MAX_WIDTH = 480; // tokens-allow: react-pdf renders the packet page at a pixel width

/** A one-page-at-a-time PDF preview (the auth packet), sized to its container. */
export default function PdfPreview({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.min(MAX_WIDTH, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = Math.round(width * LETTER);

  return (
    <div ref={box} className="flex flex-col gap-2">
      {failed ? (
        <p className="text-body text-fg-muted" role="status">
          {title} isn't available: {failed}.
        </p>
      ) : (
        <>
          {width > 0 && (
            <Document
              file={url}
              suspense={false}
              onLoadSuccess={(doc) => {
                setPages(doc.numPages);
                setPage(1);
              }}
              onLoadError={(e) => {
                // pdf.js reports HTTP failures as "Unexpected server response (409) while retrieving PDF …".
                const status = /\((\d{3})\)/.exec(e.message)?.[1];
                setFailed(status ? `the server answered HTTP ${status}` : e.message || "unknown error");
              }}
              loading={<Skeleton className="rounded-none" style={{ width, height }} />}
            >
              <div className="w-fit border border-border bg-bg" aria-label={`${title}, page ${page} of ${pages}`}>
                <Page
                  pageNumber={page}
                  width={width}
                  suspense={false}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={<Skeleton className="rounded-none" style={{ width, height }} />}
                />
              </div>
            </Document>
          )}
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-7" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft />
              </Button>
              <span className="text-meta text-fg-muted tabular-nums">
                Page {page} of {pages}
              </span>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
