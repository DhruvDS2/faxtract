import * as RD from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconButton } from "./Button";
import { X } from "./Icons";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = "max-w-lg",
  padded = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: string;
  padded?: boolean;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="animate-fade fixed inset-0 z-40 bg-black/20" />
        <RD.Content
          className={cn(
            "animate-panel fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)]",
            "-translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-panel",
            "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_40px_rgba(0,0,0,0.14)]",
            "ring-1 ring-border",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-6 px-5 pb-3 pt-4">
            <div>
              <RD.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</RD.Title>
              {description && (
                <RD.Description className="mt-0.5 text-[12.5px] text-muted">
                  {description}
                </RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <IconButton label="Close" className="-mr-1.5">
                <X />
              </IconButton>
            </RD.Close>
          </div>
          <div className={cn("max-h-[68vh] overflow-y-auto", padded && "px-5 pb-5")}>{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
