import { cn } from "@/lib/cn";

/**
 * Page heading in the instrument-console voice: an optional mission-control
 * eyebrow with a readout marker, a display-mono title, an optional lede, and
 * actions that slot to the right. The marker stays ink (monochrome) — colour
 * is reserved for consequence, never decoration.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 border-b border-border pb-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="eyebrow mb-2 flex items-center gap-1.5">
              <span aria-hidden="true" className="text-foreground">
                ▌
              </span>
              {eyebrow}
            </p>
          )}
          <h1 className="font-display text-xl font-medium tracking-tight text-foreground">
            {title}
          </h1>
          {lede && (
            <p className="mt-1.5 max-w-prose text-sm text-foreground-muted">{lede}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}

/** Section label inside a page — a smaller readout eyebrow with the ink marker. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("eyebrow mb-3 flex items-center gap-1.5", className)}>
      <span aria-hidden="true" className="text-foreground">
        ▌
      </span>
      {children}
    </p>
  );
}
