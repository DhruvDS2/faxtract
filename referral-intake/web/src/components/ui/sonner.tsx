import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const Dot = ({ className }: { className: string }) => <span aria-hidden className={cn("block size-2 rounded-full", className)} />;

/**
 * Toasts: bottom-right, lifted above the sticky actions bar (--toast-offset-bottom);
 * a bottom-left toast starts right of the nav so it never covers the nav footer.
 * The status is a dot; the text stays neutral.
 */
export function Toaster() {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      gap={8}
      offset={{
        bottom: "var(--toast-offset-bottom)",
        right: "var(--toast-offset-side)",
        left: "calc(var(--shell-nav-w) + var(--toast-offset-side))",
      }}
      icons={{
        success: <Dot className="bg-ok" />,
        error: <Dot className="bg-bad" />,
        warning: <Dot className="bg-warn" />,
        info: <Dot className="border border-idle" />,
        loading: <Dot className="animate-breathe bg-idle" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!rounded-md !border-border !bg-raised !font-sans !text-body !text-fg !shadow-float",
          title: "!font-medium !text-fg",
          description: "!text-meta !text-fg-muted",
          actionButton: "!h-7 !rounded-md !bg-accent !px-2.5 !text-meta !text-accent-fg",
          cancelButton: "!h-7 !rounded-md !bg-surface-2 !px-2.5 !text-meta !text-fg",
          closeButton: "!border-border !bg-raised !text-fg-muted",
        },
      }}
    />
  );
}
export { toast } from "sonner";
