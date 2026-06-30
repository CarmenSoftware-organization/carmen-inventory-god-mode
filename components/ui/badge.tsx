import { cn } from "@/lib/cn";

const variants = {
  neutral: "border-border bg-surface-muted text-foreground-muted",
  info: "border-info-border bg-info-subtle text-info-subtle-foreground",
  success: "border-success-border bg-success-subtle text-success-subtle-foreground",
  warning: "border-warning-border bg-warning-subtle text-warning-subtle-foreground",
  danger: "border-danger-border bg-danger-subtle text-danger-subtle-foreground",
} as const;

export type BadgeVariant = keyof typeof variants;

/** Small status/label pill. One radius scale (rounded-full), token-driven. */
export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
