import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** Shared by menus and selects: a raised hairline layer. */
export const menuContentClass = cn(
  "z-50 min-w-(--menu-min-w) rounded-md border border-border bg-raised p-1 text-body text-fg shadow-float",
  "data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
);
export const menuItemClass = cn(
  "relative flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-body text-fg outline-none select-none",
  "data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:text-fg-faint",
);

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(menuContentClass, "origin-(--radix-dropdown-menu-content-transform-origin)", className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => <DropdownMenuPrimitive.Item ref={ref} className={cn(menuItemClass, className)} {...props} />);
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />);
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => <DropdownMenuPrimitive.Label ref={ref} className={cn("px-2 py-1 text-meta text-fg-faint", className)} {...props} />);
DropdownMenuLabel.displayName = "DropdownMenuLabel";
