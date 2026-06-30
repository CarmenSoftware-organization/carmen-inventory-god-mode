import {
  Table as TableIcon,
  MagnifyingGlass,
  Package,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

const icons = {
  table: TableIcon,
  search: MagnifyingGlass,
  package: Package,
} as const;

export type EmptyStateIcon = keyof typeof icons;

/**
 * Clean empty-state placeholder. Icon + title + optional action hint.
 * Used for "no rows", "no results", "nothing selected" etc.
 */
export function EmptyState({
  icon = "package",
  title,
  hint,
  className,
}: {
  icon?: EmptyStateIcon;
  title: string;
  hint?: string;
  className?: string;
}) {
  const Icon: PhosphorIcon = icons[icon];
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center",
        className,
      )}
    >
      <Icon className="mb-3 h-8 w-8 text-foreground-subtle" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground-muted">{title}</p>
      {hint && <p className="mt-1 text-xs text-foreground-subtle">{hint}</p>}
    </div>
  );
}
