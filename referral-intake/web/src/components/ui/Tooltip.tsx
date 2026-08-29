import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RT.Provider delayDuration={500} skipDelayDuration={300}>
    {children}
  </RT.Provider>
);

/** Inverted pill. Small, quiet, gone as soon as the pointer leaves. */
export function Tooltip({
  label,
  keys,
  side = "bottom",
  children,
}: {
  label: ReactNode;
  keys?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className="animate-fade z-50 select-none rounded-md bg-primary px-2 py-1
                     text-[11.5px] text-primary-fg"
        >
          <span className="flex items-center gap-1.5">
            {label}
            {keys && <span className="font-mono opacity-50">{keys}</span>}
          </span>
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
