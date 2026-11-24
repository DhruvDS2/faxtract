import { toast } from "@/components/ui/sonner";

/**
 * Toasts for the detail screen use the shared Toaster's place: bottom-right, lifted
 * above the sticky actions bar (--toast-offset-bottom), so they cover neither the fax
 * nor the review actions. (They used to go bottom-left, over the fax pane.)
 */
type Options = NonNullable<Parameters<typeof toast>[1]>;

export const notify = {
  info: (message: string, o?: Options) => toast(message, o),
  success: (message: string, o?: Options) => toast.success(message, o),
  error: (message: string, o?: Options) => toast.error(message, o),
};
