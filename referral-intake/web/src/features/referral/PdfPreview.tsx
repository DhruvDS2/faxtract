import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Document, Page } from "./pdf";

const LETTER = 11 / 8.5;

/** A one-page-at-a-time PDF preview (prior-auth packet), sized to its container. */
export default function PdfPreview({ url, maxWidth = 440, title }: { url: string; maxWidth?: number; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.min(maxWidth, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  return (
    <div ref={box} className="flex flex-col gap-2">
      {failed ? (
        <p className="text-xs text-fg-muted" role="status">
          {title} could not be loaded: {failed}
        </p>
      ) : (
        <>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-7" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft />
              </Button>
              <span className="text-xs text-fg-muted tabular-nums">
                Page {page} of {pages}
              </span>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight />
              </Button>
            </div>
          )}
          {width > 0 && (
            <Document
              file={url}
              onLoadSuccess={(doc) => {
                setPages(doc.numPages);
                setPage(1);
              }}
              onLoadError={(e) => setFailed(e.message || "unknown error")}
              loading={<Skeleton style={{ width, height: Math.round(width * LETTER) }} />}
            >
              <div className="w-fit border border-border bg-bg" aria-label={`${title}, page ${page}`}>
                <Page
                  pageNumber={page}
                  width={width}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={<Skeleton className="rounded-none" style={{ width, height: Math.round(width * LETTER) }} />}
                />
              </div>
            </Document>
          )}
        </>
      )}
    </div>
  );
}
