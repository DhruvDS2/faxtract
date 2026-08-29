import { useEffect, useRef, useState } from "react";
import type { Box } from "../api";
import { pageUrl } from "../api";
import { cn } from "../lib/cn";
import { labelFor } from "../lib/fields";
import { IconButton } from "./ui/Button";
import { ChevronLeft, ChevronRight, Expand, Minus, Plus, Spinner } from "./ui/Icons";

/**
 * The fax scan with the extractor's source regions drawn over it. Box
 * coordinates arrive normalized 0-1 (Textract geometry), so they survive both
 * zoom and the server's render DPI without conversion.
 */
export default function FaxViewer({
  id,
  page,
  pages,
  onPage,
  activeField,
  boxes,
  revealNonce,
}: {
  id: string;
  page: number;
  pages: number;
  onPage: (page: number) => void;
  activeField: string | null;
  boxes: Box[];
  revealNonce: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const pendingScroll = useRef(false);

  const here = boxes.filter((b) => b.page === page);
  const elsewhere = boxes.length > 0 && here.length === 0 ? boxes[0].page : null;

  const scrollToBox = (box: Box) => {
    const container = scrollRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const centerX = (box.left + box.width / 2) * img.clientWidth;
    const centerY = (box.top + box.height / 2) * img.clientHeight;
    container.scrollTo({
      left: centerX - container.clientWidth / 2,
      top: centerY - container.clientHeight / 2,
      behavior: "smooth",
    });
  };

  // A reveal either scrolls now, or flips the page and scrolls once it loads.
  useEffect(() => {
    if (!revealNonce) return;
    const [box] = boxes;
    if (!box) return;
    if (box.page !== page) {
      pendingScroll.current = true;
      onPage(box.page);
    } else {
      scrollToBox(box);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce]);

  useEffect(() => setLoading(true), [page, id]);

  const onImageLoad = () => {
    setLoading(false);
    if (!pendingScroll.current) return;
    pendingScroll.current = false;
    const [box] = boxes;
    if (box && box.page === page) scrollToBox(box);
  };

  const zoomBy = (delta: number) => setZoom((z) => Math.min(4, Math.max(0.5, z + delta)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-0.5 px-2">
        <IconButton label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </IconButton>
        <span className="nums px-1 text-[12px] text-muted">
          {page + 1}/{pages}
        </span>
        <IconButton
          label="Next page"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight />
        </IconButton>

        <span className="mx-2 h-3.5 w-px bg-border" />

        <IconButton label="Zoom out" onClick={() => zoomBy(-0.25)} disabled={zoom <= 0.5}>
          <Minus />
        </IconButton>
        <span className="nums w-9 text-center text-[12px] text-muted">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton label="Zoom in" onClick={() => zoomBy(0.25)} disabled={zoom >= 4}>
          <Plus />
        </IconButton>
        <IconButton label="Fit to width" onClick={() => setZoom(1)}>
          <Expand />
        </IconButton>

        <div className="flex-1" />

        {activeField && (
          <span className={cn("text-[12px]", here.length ? "text-amber" : "text-faint")}>
            {here.length > 0
              ? labelFor(activeField)
              : elsewhere !== null
                ? `${labelFor(activeField)} — page ${elsewhere + 1}`
                : `${labelFor(activeField)} — no source`}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-subtle px-6 pb-6">
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner size={16} className="text-faint" />
          </div>
        )}
        {/* The wrapper carries the zoom so the overlay scales with the image. */}
        <div className="relative mx-auto" style={{ width: `${zoom * 100}%` }}>
          <img
            ref={imgRef}
            key={`${id}-${page}`}
            src={pageUrl(id, page)}
            alt={`Fax page ${page + 1}`}
            onLoad={onImageLoad}
            className={cn(
              "block w-full rounded-md bg-white shadow-[0_1px_3px_rgba(0,0,0,0.10)]",
              "transition-opacity duration-150",
              loading ? "opacity-0" : "opacity-100",
            )}
          />
          {!loading &&
            here.map((box, i) => (
              <div
                key={i}
                className="source-box animate-reveal pointer-events-none absolute"
                style={{
                  left: `${box.left * 100}%`,
                  top: `${box.top * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
