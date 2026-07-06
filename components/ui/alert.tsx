import {
  TriangleAlert,
  CheckCircle2,
  Info,
  CircleX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

const variants = {
  danger: {
    wrap: "border-danger-border bg-danger-subtle text-danger-subtle-foreground",
    icon: CircleX,
    title: "text-danger-subtle-foreground",
  },
  warning: {
    wrap: "border-warning-border bg-warning-subtle text-warning-subtle-foreground",
    icon: TriangleAlert,
    title: "text-warning-subtle-foreground",
  },
  success: {
    wrap: "border-success-border bg-success-subtle text-success-subtle-foreground",
    icon: CheckCircle2,
    title: "text-success-subtle-foreground",
  },
  info: {
    wrap: "border-info-border bg-info-subtle text-info-subtle-foreground",
    icon: Info,
    title: "text-info-subtle-foreground",
  },
} as const;

export type AlertVariant = keyof typeof variants;

/**
 * Inline callout for status/danger/success. Renders icon + title + optional body.
 * Status is never conveyed by color alone — always pairs with an icon + text.
 */
export function Alert({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: AlertVariant;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const v = variants[variant];
  const Icon: LucideIcon = v.icon;
  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-md border p-3 text-sm", v.wrap, className)}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className={cn("font-semibold", v.title)}>{title}</p>
        {children && <div className="text-sm opacity-90">{children}</div>}
      </div>
    </div>
  );
}
