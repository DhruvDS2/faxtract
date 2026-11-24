import { toast } from "@/components/ui/sonner";

/**
 * Toasts for the detail screen. The shared Toaster sits bottom-right, exactly over the
 * sticky actions bar (Approve / Save), and sonner pauses a toast while it is hovered,
 * so detail toasts go bottom-left (over the sidebar footer and the fax margin), where
 * they never cover a review action, a validation message or the fields being edited.
 */
type Options = NonNullable<Parameters<typeof toast>[1]>;
const at = (o?: Options): Options => ({ position: "bottom-left", ...o });

export const notify = {
  info: (message: string, o?: Options) => toast(message, at(o)),
  success: (message: string, o?: Options) => toast.success(message, at(o)),
  error: (message: string, o?: Options) => toast.error(message, at(o)),
};
