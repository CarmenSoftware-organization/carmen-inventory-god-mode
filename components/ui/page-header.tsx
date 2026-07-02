import { cn } from "@/lib/cn";

/**
 * Page heading in the ledger voice: an optional rubric line, a display-mono
 * title (Fraunces), an optional lede, and actions that slot to the right.
 * The rubric carries the hierarchical voice; colour is reserved for
 * consequence, never decoration.
 */
export function PageHeader({
  rubric,
  title,
  lede,
  actions,
  className,
}: {
  rubric?: string;
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 border-b border-border pb-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {rubric && <p className="rubric mb-2">{rubric}</p>}
          <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">
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

/** Section label inside a page — a smaller readout rubric. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn("rubric mb-3", className)}>{children}</p>;
}
