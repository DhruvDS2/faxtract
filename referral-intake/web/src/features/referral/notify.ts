import { toast } from "@/components/ui/sonner";

/**
 * Toasts for the detail screen. Review actions live in the page header now, so the
 * shared Toaster's bottom-right slot never covers one.
 */
type Options = NonNullable<Parameters<typeof toast>[1]>;

export const notify = {
  info: (message: string, o?: Options) => toast(message, o),
  success: (message: string, o?: Options) => toast.success(message, o),
  error: (message: string, o?: Options) => toast.error(message, o),
};
