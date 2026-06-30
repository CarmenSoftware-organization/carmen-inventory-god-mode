"use client";

import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * Tab switcher. Renders as a row of buttons with a bottom-border active indicator.
 * Uses controlled `active` + `onChange` so parent owns state.
 */
export function Tabs({ items, active, onChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1 border-b border-border", className)}
    >
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "text-foreground"
                : "text-foreground-muted hover:text-foreground",
            )}
          >
            {item.label}
            {item.count != null && (
              <span
                className={cn(
                  "ml-1.5 text-xs",
                  isActive ? "text-foreground-muted" : "text-foreground-subtle",
                )}
              >
                {item.count}
              </span>
            )}
            {/* Active indicator bar */}
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
