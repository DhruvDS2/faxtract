import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!rounded-md !border !border-border !bg-bg !text-fg !shadow-float !text-sm",
          description: "!text-fg-muted",
          error: "!text-bad",
          success: "!text-ok",
        },
      }}
    />
  );
}
export { toast } from "sonner";
