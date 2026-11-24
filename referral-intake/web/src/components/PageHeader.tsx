export function PageHeader({ title, meta, actions }: { title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-2">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {meta && <div className="text-xs text-fg-muted">{meta}</div>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3 py-1">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}
