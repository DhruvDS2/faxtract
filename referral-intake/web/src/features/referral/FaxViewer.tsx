import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff, Minus, Plus } from "lucide-react";
import type { Box } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { DURATION_MS, EASE, beginTransition, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { cubicBezier, focusZoom, fromContent, pageAt, pageTop, scrollFor, type DocPoint, type Layout } from "./camera";
import { Document, Page } from "./pdf";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const LETTER = 11 / 8.5;
const easeEnter = cubicBezier(...EASE.enter);
/** Canvas backing scale relative to the screen: crisp up to 2× zoom without re-rendering. */
const OVERSAMPLE = 2;

export type FocusRequest = { field: string; n: number };

export type FaxViewerProps = {
  url: string;
  boxes: Record<string, Box[]>;
  /** The selected field: outlined, and the camera flies to it on each new request. */
  selectedField: string | null;
  focus: FocusRequest | null;
  /** The field hovered here or in the field list: its box is highlighted. */
  hoveredField: string | null;
  onSelectField: (field: string | null) => void;
  onHoverField: (field: string | null) => void;
  labelFor: (field: string) => string;
};

/**
 * The fax (react-pdf), every page stacked, with the extraction boxes on top.
 * Selecting a field pans and zooms to its box (320 ms, enter curve) and gives it a
 * soft 2 px outline. Pages render once at fit width (oversampled); zoom is a scale
 * on top, so a flight never re-renders the canvas. Reduced motion: it jumps.
 */
export default function FaxViewer({ url, boxes, selectedField, focus, hoveredField, onSelectField, onHoverField, labelFor }: FaxViewerProps) {
  const { reduce } = useMotionPrefs();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const frames = useRef<(HTMLDivElement | null)[]>([]);
  const stages = useRef<(HTMLDivElement | null)[]>([]);
  const zoomRef = useRef(1);
  const flight = useRef<{ raf: number; end: () => void } | null>(null);

  const [fitWidth, setFitWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [aspects, setAspects] = useState<number[]>([]);
  const [rendered, setRendered] = useState(false);
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showBoxes, setShowBoxes] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  // Fit width follows the pane (one frame of debounce).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const pad = content.current ? parseFloat(getComputedStyle(content.current).paddingLeft) || 0 : 0;
        setFitWidth(Math.max(160, Math.floor(el.clientWidth - pad * 2)));
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const layout = useCallback((): Layout | null => {
    const el = scroller.current;
    const c = content.current;
    if (!el || !c || !fitWidth || !numPages) return null;
    const cs = getComputedStyle(c);
    return {
      W: fitWidth,
      aspects: Array.from({ length: numPages }, (_, i) => aspects[i] ?? LETTER),
      pad: parseFloat(cs.paddingTop) || 0,
      gap: parseFloat(cs.rowGap) || 0,
      clientW: el.clientWidth,
      clientH: el.clientHeight,
    };
  }, [fitWidth, numPages, aspects]);

  /** Size every page frame for zoom z (imperative: flights write this every frame). */
  const apply = useCallback(
    (z: number) => {
      zoomRef.current = z;
      for (let i = 0; i < numPages; i++) {
        const frame = frames.current[i];
        const stage = stages.current[i];
        const aspect = aspects[i] ?? LETTER;
        if (frame) {
          frame.style.width = `${fitWidth * z}px`;
          frame.style.height = `${fitWidth * aspect * z}px`;
        }
        if (stage) stage.style.transform = `scale(${z})`;
      }
    },
    [fitWidth, numPages, aspects],
  );

  // Keep the DOM at the current zoom across renders (React doesn't own frame sizes).
  useLayoutEffect(() => apply(zoomRef.current));

  const stop = useCallback(() => {
    const f = flight.current;
    if (!f) return;
    cancelAnimationFrame(f.raf);
    f.end();
    flight.current = null;
    setZoom(zoomRef.current);
  }, []);
  useEffect(() => stop, [stop]);

  const centre = (L: Layout, z: number): DocPoint => {
    const el = scroller.current!;
    return fromContent(L, el.scrollLeft + L.clientW / 2, el.scrollTop + L.clientH / 2, z);
  };

  /** Fly the camera to zoom z1 with document point p1 centred. */
  const fly = useCallback(
    (z1: number, p1: DocPoint | ((L: Layout) => DocPoint)) => {
      const el = scroller.current;
      const L = layout();
      if (!el || !L) return;
      stop();
      const target = typeof p1 === "function" ? p1(L) : p1;
      const z0 = zoomRef.current;
      const p0 = centre(L, z0);
      const land = () => {
        apply(z1);
        const s = scrollFor(L, target, z1);
        el.scrollLeft = s.left;
        el.scrollTop = s.top;
        setZoom(z1);
      };
      if (reduce) return land();
      const t0 = performance.now();
      const end = beginTransition();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / DURATION_MS.panel);
        const e = easeEnter(t);
        const z = z0 + (z1 - z0) * e;
        apply(z);
        const s = scrollFor(L, { u: p0.u + (target.u - p0.u) * e, g: p0.g + (target.g - p0.g) * e }, z);
        el.scrollLeft = s.left;
        el.scrollTop = s.top;
        if (t < 1) flight.current = { raf: requestAnimationFrame(step), end };
        else {
          flight.current = null;
          end();
          setZoom(z1);
        }
      };
      flight.current = { raf: requestAnimationFrame(step), end };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, apply, stop, reduce],
  );

  // A field was selected (here or in the list): fly to its first box once the page has drawn.
  useEffect(() => {
    if (!focus || !rendered) return;
    const box = boxes[focus.field]?.[0];
    const L = layout();
    if (!box || !L) return;
    fly(focusZoom(L, box.width), { u: box.left + box.width / 2, g: box.page + box.top + box.height / 2 });
    // Only on a new request (or once the fax has rendered).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, focus?.field, rendered]);

  const onScroll = () => {
    const L = layout();
    if (L) setCurrent(pageAt(L, scroller.current!.scrollTop, zoomRef.current));
  };

  const zoomTo = (z: number) => fly(z, (L) => centre(L, zoomRef.current));
  const fit = () => fly(1, (L) => ({ ...centre(L, zoomRef.current), u: 0.5 }));
  const goTo = (page: number) =>
    fly(zoomRef.current, (L) => {
      const z = zoomRef.current;
      const p = fromContent(L, scroller.current!.scrollLeft + L.clientW / 2, pageTop(L, page, z) - L.pad + L.clientH / 2, z);
      return { u: p.u, g: Math.max(page, p.g) };
    });

  const byPage = useMemo(() => {
    const out = new Map<number, { field: string; box: Box; k: number }[]>();
    for (const [field, list] of Object.entries(boxes ?? {}))
      (list ?? []).forEach((box, k) => {
        const arr = out.get(box.page) ?? [];
        arr.push({ field, box, k });
        out.set(box.page, arr);
      });
    return out;
  }, [boxes]);

  const lower = [...ZOOMS].reverse().find((z) => z < zoom - 0.01);
  const higher = ZOOMS.find((z) => z > zoom + 0.01);
  const ready = numPages > 0 && fitWidth > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-2" data-testid="fax-viewer">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-bg px-2">
        <Button variant="ghost" size="icon" className="size-7" aria-label="Previous page" disabled={current <= 0} onClick={() => goTo(current - 1)}>
          <ChevronLeft />
        </Button>
        <span className="min-w-20 text-center text-meta text-fg-muted tabular-nums" aria-live="polite">
          {numPages ? `Page ${current + 1} of ${numPages}` : "Fax"}
        </span>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Next page" disabled={current >= numPages - 1} onClick={() => goTo(current + 1)}>
          <ChevronRight />
        </Button>

        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-7" aria-label="Zoom out" disabled={!ready || lower == null} onClick={() => lower != null && zoomTo(lower)}>
            <Minus />
          </Button>
          <Tip content="Zoom, relative to fitting the pane width">
            <span className="min-w-11 text-center text-meta text-fg-muted tabular-nums">{Math.round(zoom * 100)}%</span>
          </Tip>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Zoom in" disabled={!ready || higher == null} onClick={() => higher != null && zoomTo(higher)}>
            <Plus />
          </Button>
          <Button variant="ghost" size="sm" disabled={!ready || Math.abs(zoom - 1) < 0.01} onClick={fit}>
            Fit
          </Button>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <Tip content={showBoxes ? "Hide field boxes (the selected field stays outlined)" : "Show every extracted field box"}>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Show field boxes" aria-pressed={showBoxes} onClick={() => setShowBoxes((v) => !v)}>
              {showBoxes ? <Eye /> : <EyeOff />}
            </Button>
          </Tip>
          <Tip content="Open the original PDF">
            <Button variant="ghost" size="icon" className="size-7" asChild>
              <a href={url} target="_blank" rel="noreferrer" aria-label="Open the original PDF in a new tab">
                <ExternalLink />
              </a>
            </Button>
          </Tip>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        onWheel={stop}
        onPointerDown={stop}
        className="relative min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
      >
        <Document
          key={attempt}
          file={url}
          suspense={false}
          inputRef={content}
          onLoadSuccess={(doc) => {
            setNumPages(doc.numPages);
            setCurrent(0);
          }}
          loading={<Skeleton className="rounded-none" style={{ width: fitWidth || undefined, aspectRatio: `${1 / LETTER}` }} />}
          error={
            <div className="flex flex-col items-center gap-1 px-6 py-16 text-center" role="alert">
              <div className="text-body font-medium text-fg">Couldn't load the fax</div>
              <div className="text-body text-fg-muted">The PDF may be missing on the server.</div>
              <Button size="sm" className="mt-3" onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </Button>
            </div>
          }
          className="flex w-max min-w-full flex-col items-center gap-4 p-4"
        >
          {fitWidth > 0 &&
            Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                ref={(el) => {
                  frames.current[i] = el;
                }}
                data-page={i + 1}
                className="relative shrink-0 overflow-hidden bg-bg shadow-float"
              >
                <div
                  ref={(el) => {
                    stages.current[i] = el;
                  }}
                  className="absolute top-0 left-0 origin-top-left"
                  style={{ width: fitWidth }}
                >
                  <Page
                    pageNumber={i + 1}
                    width={fitWidth}
                    devicePixelRatio={dpr * OVERSAMPLE}
                    suspense={false}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onLoadSuccess={(p) =>
                      setAspects((a) => {
                        const next = [...a];
                        next[i] = p.originalHeight / p.originalWidth;
                        return next;
                      })
                    }
                    onRenderSuccess={() => i === 0 && setRendered(true)}
                    loading={<Skeleton className="rounded-none" style={{ width: fitWidth, height: Math.round(fitWidth * (aspects[i] ?? LETTER)) }} />}
                  />
                </div>
                <div className="absolute inset-0">
                  {(byPage.get(i) ?? []).map(({ field, box, k }) => {
                    const selected = field === selectedField;
                    const hovered = field === hoveredField;
                    if (!showBoxes && !selected && !hovered) return null;
                    return (
                      <button
                        key={`${field}-${k}`}
                        type="button"
                        tabIndex={-1}
                        data-field={k === 0 ? field : undefined}
                        data-state={selected ? "selected" : hovered ? "hovered" : undefined}
                        aria-label={`${labelFor(field)} on the fax`}
                        onClick={() => onSelectField(selected ? null : field)}
                        onMouseEnter={() => onHoverField(field)}
                        onMouseLeave={() => onHoverField(null)}
                        className={cn(
                          "absolute cursor-pointer rounded-sm outline-offset-2 transition-[outline-color,background-color] duration-state ease-enter",
                          selected
                            ? "z-10 bg-focus/10 outline-2 outline-focus"
                            : hovered
                              ? "z-10 bg-focus/5 outline-1 outline-focus"
                              : "outline-1 outline-control/45 hover:outline-focus",
                        )}
                        style={{
                          left: `${box.left * 100}%`,
                          top: `${box.top * 100}%`,
                          width: `${box.width * 100}%`,
                          height: `${box.height * 100}%`,
                        }}
                      >
                        {k === 0 && (selected || hovered) && (
                          <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 animate-fade-in rounded-sm bg-fg px-1.5 text-meta whitespace-nowrap text-bg dark:bg-bg dark:text-fg">
                            {labelFor(field)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </Document>
      </div>
    </div>
  );
}
