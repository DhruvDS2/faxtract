import { toast } from "@/components/ui/sonner";

/**
 * Toasts for the detail screen go bottom-left, over the fax's margin: bottom-right
 * would sit on the fields and panels being worked on. The shared Toaster starts a
 * bottom-left toast right of the nav, so it never covers the nav either.
 */
type Options = NonNullable<Parameters<typeof toast>[1]>;
const at = (o?: Options): Options => ({ position: "bottom-left", ...o });

export const notify = {
  info: (message: string, o?: Options) => toast(message, at(o)),
  success: (message: string, o?: Options) => toast.success(message, at(o)),
  error: (message: string, o?: Options) => toast.error(message, at(o)),
};
