import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff, Minus, Plus } from "lucide-react";
import type { Box } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Document, Page } from "./pdf";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const LETTER = 11 / 8.5;

export type FaxViewerProps = {
  url: string;
  boxes: Record<string, Box[]>;
  /** The field whose box is emphasised (hovered, else selected). */
  activeField: string | null;
  selectedField: string | null;
  onSelectField: (field: string | null) => void;
  onHoverField: (field: string | null) => void;
  labelFor: (field: string) => string;
};

/** The fax PDF (react-pdf), every page stacked, with the extraction boxes on top. */
export default function FaxViewer({ url, boxes, activeField, selectedField, onSelectField, onHoverField, labelFor }: FaxViewerProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [fitWidth, setFitWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [showBoxes, setShowBoxes] = useState(true);
  const [rendered, setRendered] = useState(0);
  const [attempt, setAttempt] = useState(0);

  // Fit-width: follow the pane's size (debounced to one frame).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFitWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  const pageWidth = Math.round(fitWidth * zoom);

  const byPage = useMemo(() => {
    const out = new Map<number, { field: string; box: Box; i: number }[]>();
    for (const [field, list] of Object.entries(boxes ?? {}))
      (list ?? []).forEach((box, i) => {
        const arr = out.get(box.page) ?? [];
        arr.push({ field, box, i });
        out.set(box.page, arr);
      });
    return out;
  }, [boxes]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const probe = el.scrollTop + el.clientHeight / 3;
    let page = 1;
    pageEls.current.forEach((p, i) => {
      if (p && p.offsetTop <= probe) page = i + 1;
    });
    setCurrent(page);
  }, []);

  const goTo = (n: number) => {
    const el = scroller.current;
    const target = pageEls.current[n - 1];
    if (el && target) el.scrollTo({ top: target.offsetTop - 16, behavior: "smooth" });
  };

  // Bring the active field's box into view when it is off-screen. The short delay
  // keeps a mouse sweeping across the field list from yanking the fax around.
  useEffect(() => {
    if (!activeField) return;
    const t = window.setTimeout(() => {
      const el = scroller.current;
      const box = el?.querySelector<HTMLElement>(`[data-field="${CSS.escape(activeField)}"]`);
      if (!el || !box) return;
      const s = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const visible = b.top >= s.top + 24 && b.bottom <= s.bottom - 8 && b.left >= s.left && b.right <= s.right;
      if (!visible)
        el.scrollBy({
          top: b.top - s.top - s.height / 3,
          left: b.left < s.left || b.right > s.right ? b.left - s.left - s.width / 3 : 0,
          behavior: "smooth",
        });
    }, 120);
    return () => window.clearTimeout(t);
  }, [activeField, rendered, pageWidth]);

  const zoomIndex = ZOOMS.indexOf(zoom);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="fax-viewer">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
        <span className="px-1 text-xs font-medium text-fg-muted">Fax</span>
        <div className="ml-2 flex items-center">
          <Button variant="ghost" size="icon" className="size-7" aria-label="Previous page" disabled={current <= 1} onClick={() => goTo(current - 1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-16 text-center text-xs text-fg-muted tabular-nums" aria-live="polite">
            {numPages ? `${current} / ${numPages}` : "-"}
          </span>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Next page" disabled={current >= numPages} onClick={() => goTo(current + 1)}>
            <ChevronRight />
          </Button>
        </div>

        <div className="ml-auto flex items-center">
          <Button variant="ghost" size="icon" className="size-7" aria-label="Zoom out" disabled={zoomIndex <= 0} onClick={() => setZoom(ZOOMS[zoomIndex - 1])}>
            <Minus />
          </Button>
          <Tip content="Zoom, relative to fitting the pane width">
            <span className="min-w-12 text-center text-xs text-fg-muted tabular-nums">{Math.round(zoom * 100)}%</span>
          </Tip>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Zoom in" disabled={zoomIndex >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zoomIndex + 1])}>
            <Plus />
          </Button>
          <Button variant="ghost" size="sm" disabled={zoom === 1} onClick={() => setZoom(1)}>
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

      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto bg-surface-2 p-4 [scrollbar-gutter:stable]">
        <Document
          key={attempt}
          file={url}
          suspense={false}
          onLoadSuccess={(doc) => {
            setNumPages(doc.numPages);
            setCurrent(1);
          }}
          loading={<Skeleton className="mx-auto w-full" style={{ aspectRatio: `${1 / LETTER}` }} />}
          error={
            <div className="flex flex-col items-center gap-2 py-16 text-center" role="alert">
              <AlertTriangle className="size-5 text-bad" />
              <div className="text-sm font-medium">Could not load the fax PDF</div>
              <div className="text-xs text-fg-muted">The file may be missing on the server.</div>
              <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </Button>
            </div>
          }
          className="flex flex-col items-center gap-4"
        >
          {fitWidth > 0 &&
            Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                ref={(el) => {
                  pageEls.current[i] = el;
                }}
                data-page={i + 1}
                className="relative shrink-0 border border-border bg-bg"
                style={{ width: pageWidth }}
              >
                <Page
                  pageNumber={i + 1}
                  width={pageWidth}
                  suspense={false}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onRenderSuccess={() => setRendered((n) => n + 1)}
                  loading={<Skeleton className="rounded-none" style={{ width: pageWidth, height: Math.round(pageWidth * LETTER) }} />}
                />
                <div className="absolute inset-0">
                  {(byPage.get(i) ?? []).map(({ field, box, i: k }) => {
                    const active = field === activeField;
                    const selected = field === selectedField;
                    if (!showBoxes && !active && !selected) return null;
                    return (
                      <button
                        key={`${field}-${k}`}
                        type="button"
                        tabIndex={-1}
                        data-field={k === 0 ? field : undefined}
                        aria-label={`${labelFor(field)} on the fax`}
                        onClick={() => onSelectField(selected ? null : field)}
                        onMouseEnter={() => onHoverField(field)}
                        onMouseLeave={() => onHoverField(null)}
                        className={cn(
                          "absolute rounded-sm border transition-colors duration-150",
                          active || selected
                            ? "z-10 border-accent bg-accent/10 outline-2 outline-accent"
                            : "border-accent/30 hover:border-accent hover:bg-accent/10",
                        )}
                        style={{
                          left: `calc(${box.left * 100}% - 3px)`,
                          top: `calc(${box.top * 100}% - 3px)`,
                          width: `calc(${box.width * 100}% + 6px)`,
                          height: `calc(${box.height * 100}% + 6px)`,
                        }}
                      >
                        {active && (
                          <span className="pointer-events-none absolute bottom-full left-0 mb-1 rounded-sm bg-accent px-1 text-xs whitespace-nowrap text-accent-fg">
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
