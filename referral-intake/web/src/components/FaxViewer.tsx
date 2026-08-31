import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Box } from "../api";
import { pageUrl } from "../api";
import { cn } from "../lib/cn";
import { labelFor } from "../lib/fields";
import { IconButton } from "./ui/Button";
import { ChevronLeft, ChevronRight, Expand, Minus, Plus, Spinner } from "./ui/Icons";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

/** A peek stops well short of the manual ceiling. Filling the viewport with one
 *  field throws away the neighbouring lines that tell a reviewer they are even
 *  looking at the right row, and magnifies any drift in the box coordinates. */
const PEEK_MAX_ZOOM = 2;

/** Share of the viewport a peeked region should fill. */
const PEEK_FILL = 0.35;

/** Dragging the pointer down the field list crosses every field on the way. A
 *  short delay means only the field actually settled on triggers a peek. */
const PEEK_DELAY_MS = 130;

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const peekClamp = (z: number) => Math.min(PEEK_MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** The single rectangle covering every box a field claims on one page. A field
 *  read from two lines has two boxes, and framing them one at a time would hide
 *  half the evidence. */
function regionOf(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const page = boxes[0].page;
  const same = boxes.filter((b) => b.page === page);
  const left = Math.min(...same.map((b) => b.left));
  const top = Math.min(...same.map((b) => b.top));
  const right = Math.max(...same.map((b) => b.left + b.width));
  const bottom = Math.max(...same.map((b) => b.top + b.height));
  return { page, left, top, width: right - left, height: bottom - top };
}

/**
 * The fax scan with the extractor's source regions drawn over it. Box
 * coordinates arrive normalized 0-1 (Textract geometry), so they survive both
 * zoom and the server's render DPI without conversion.
 *
 * Hovering a field *peeks*: the view jumps to that field's region and zooms in
 * far enough to read it, then restores the exact page, zoom, and scroll on the
 * way out. A peek must never cost the reviewer the place they were reading.
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
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const pendingScroll = useRef(false);

  // The region currently framed, and the view to put back when the peek ends.
  const [peek, setPeek] = useState<Box | null>(null);
  const restore = useRef<{ page: number; zoom: number; left: number; top: number } | null>(null);
  const restoreScroll = useRef<{ left: number; top: number } | null>(null);

  const here = boxes.filter((b) => b.page === page);
  const elsewhere = boxes.length > 0 && here.length === 0 ? boxes[0].page : null;

  const scrollToBox = (box: Box, behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!container || !stage || !img) return;
    // The stage is padded and centred inside the scroller, so its own offset has
    // to be added or the centring drifts by that margin at low zoom.
    const centerX = stage.offsetLeft + (box.left + box.width / 2) * img.clientWidth;
    const centerY = stage.offsetTop + (box.top + box.height / 2) * img.clientHeight;
    container.scrollTo({
      left: centerX - container.clientWidth / 2,
      top: centerY - container.clientHeight / 2,
      behavior,
    });
  };

  /** Zoom that fills PEEK_FILL of the viewport on whichever axis binds first, so
   *  a wide region is framed by width and a tall one by height. */
  const zoomFor = (box: Box) => {
    const container = scrollRef.current;
    const img = imgRef.current;
    if (!container || !img || !img.clientWidth || !img.clientHeight) return zoom;
    const pageW = img.clientWidth / zoom; // what the page measures at 100%
    const pageH = img.clientHeight / zoom;
    const byW =
      box.width > 0 ? (PEEK_FILL * container.clientWidth) / (box.width * pageW) : PEEK_MAX_ZOOM;
    const byH =
      box.height > 0 ? (PEEK_FILL * container.clientHeight) / (box.height * pageH) : PEEK_MAX_ZOOM;
    return peekClamp(Math.min(byW, byH));
  };

  const beginPeek = (region: Box) => {
    const container = scrollRef.current;
    if (!container) return;
    // Only the first peek in a run records the restore point: moving straight
    // from one field to the next should still return to where the run started.
    if (!restore.current) {
      restore.current = { page, zoom, left: container.scrollLeft, top: container.scrollTop };
    }
    restoreScroll.current = null;
    setPeek(region);
    setZoom(zoomFor(region));
    if (region.page !== page) onPage(region.page);
  };

  const endPeek = () => {
    const saved = restore.current;
    if (!saved) return;
    restore.current = null;
    setPeek(null);
    restoreScroll.current = { left: saved.left, top: saved.top };
    setZoom(saved.zoom);
    if (saved.page !== page) onPage(saved.page);
  };

  /** A deliberate zoom outranks the peek: keep it, and stop trying to restore. */
  const commit = () => {
    restore.current = null;
    restoreScroll.current = null;
    setPeek(null);
  };

  // Hovering or focusing a field frames its region; leaving puts the view back.
  useEffect(() => {
    const region = activeField ? regionOf(boxes) : null;
    if (!region) {
      endPeek();
      return;
    }
    const timer = window.setTimeout(() => beginPeek(region), PEEK_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeField, boxes]);

  // Zoom and page changes relayout the stage, so a scroll that depends on the
  // new layout has to be applied after it lands, not in the tick that asked for it.
  useLayoutEffect(() => {
    if (loading) return;
    if (peek && peek.page === page) {
      scrollToBox(peek, "auto");
      return;
    }
    if (restoreScroll.current) {
      scrollRef.current?.scrollTo({ ...restoreScroll.current, behavior: "auto" });
      restoreScroll.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek, zoom, page, loading]);

  // A reveal either scrolls now, or flips the page and scrolls once it loads.
  // Either way it is a deliberate jump, so it keeps the view it lands on.
  useEffect(() => {
    if (!revealNonce) return;
    const [box] = boxes;
    if (!box) return;
    restore.current = null;
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

  const zoomBy = (delta: number) => {
    commit();
    setZoom((z) => clamp(z + delta));
  };

  const fitToWidth = () => {
    commit();
    setZoom(1);
  };

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

        <IconButton label="Zoom out" onClick={() => zoomBy(-0.25)} disabled={zoom <= MIN_ZOOM}>
          <Minus />
        </IconButton>
        {/* Amber while peeking, so a zoom that is about to undo itself is never
            mistaken for one the reviewer set. */}
        <span
          className={cn("nums w-9 text-center text-[12px]", peek ? "text-amber" : "text-muted")}
        >
          {Math.round(zoom * 100)}%
        </span>
        <IconButton label="Zoom in" onClick={() => zoomBy(0.25)} disabled={zoom >= MAX_ZOOM}>
          <Plus />
        </IconButton>
        <IconButton label="Fit to width" onClick={fitToWidth}>
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
        <div ref={stageRef} className="relative mx-auto" style={{ width: `${zoom * 100}%` }}>
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
