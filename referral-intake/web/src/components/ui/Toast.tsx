import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";

export type Toast = { id: number; tone: "good" | "bad" | "neutral"; text: string };

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l([...toasts]));

const dismiss = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

/** Fire-and-forget confirmation. Kept outside React so any module can call it. */
export function toast(text: string, tone: Toast["tone"] = "neutral") {
  const id = nextId++;
  toasts = [...toasts, { id, tone, text }];
  emit();
  setTimeout(() => dismiss(id), 4000);
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <button
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={cn(
            "animate-rise pointer-events-auto flex items-center gap-2 rounded-lg px-3.5 py-2",
            "bg-primary text-[12.5px] text-primary-fg",
            "shadow-[0_8px_28px_rgba(0,0,0,0.20)]",
          )}
        >
          <span
            className={cn(
              "h-[5px] w-[5px] shrink-0 rounded-full",
              t.tone === "good" && "bg-green",
              t.tone === "bad" && "bg-red",
              t.tone === "neutral" && "bg-current opacity-40",
            )}
          />
          {t.text}
        </button>
      ))}
    </div>
  );
}
