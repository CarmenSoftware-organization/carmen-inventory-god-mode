import { cn } from "@/lib/cn";

/**
 * Shimmer skeleton loader. Matches the shape of the content being loaded.
 * Uses a subtle animation that respects prefers-reduced-motion.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "animate-pulse rounded-md bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Pre-built skeleton row for tables — matches a single data row. */
export function SkeletonRow({ cols = 4, className }: { cols?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 border-b border-border px-3 py-2", className)}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4 flex-1"
          style={{ maxWidth: `${60 + (i * 20) % 40}%` }}
        />
      ))}
    </div>
  );
}
