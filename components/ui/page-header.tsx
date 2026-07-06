import { cn } from "@/lib/cn";

/** Page heading: an optional eyebrow label, a title, an optional lede, and right-aligned actions. */
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
          {rubric && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
              {rubric}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {lede && (
            <p className="mt-1.5 max-w-prose text-sm text-foreground-muted">{lede}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Section label inside a page. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("mb-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted", className)}>
      {children}
    </p>
  );
}
