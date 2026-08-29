import { cn } from "../../lib/cn";

/** A key cap. Deliberately faint — a hint, never a focal point. */
export const Kbd = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <kbd
    className={cn(
      "inline-flex h-[17px] min-w-[17px] items-center justify-center rounded",
      "bg-subtle px-1 font-sans text-[10px] font-medium leading-none text-faint",
      className,
    )}
  >
    {children}
  </kbd>
);
