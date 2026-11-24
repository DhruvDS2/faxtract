import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/** Text tabs on a hairline; the active tab is neutral (fg underline), never teal. */
export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn("flex h-10 items-end gap-6 border-b border-border", className)} {...props} />
));
TabsList.displayName = "TabsList";

/**
 * Radix moves focus to a tab itself when it's clicked, which the browser counts as
 * :focus-visible, so the ring showed after a mouse click. A pointer press marks the
 * tab; a key press (or leaving it) unmarks it: the ring is for keyboard focus only.
 */
export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, onPointerDown, onKeyDown, onBlur, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "-mb-px inline-flex h-10 cursor-pointer items-center gap-1.5 border-b-2 border-transparent text-body font-medium text-fg-muted",
      "transition-[color,border-color] duration-fast ease-enter hover:text-fg",
      "data-[state=active]:border-fg data-[state=active]:text-fg disabled:cursor-not-allowed disabled:opacity-45",
      "data-[pointer]:outline-none",
      className,
    )}
    onPointerDown={(e) => {
      e.currentTarget.dataset.pointer = "";
      onPointerDown?.(e);
    }}
    onKeyDown={(e) => {
      delete e.currentTarget.dataset.pointer;
      onKeyDown?.(e);
    }}
    onBlur={(e) => {
      delete e.currentTarget.dataset.pointer;
      onBlur?.(e);
    }}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn("pt-4 outline-none", className)} {...props} />);
TabsContent.displayName = "TabsContent";
