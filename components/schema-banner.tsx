import { env } from "@/lib/env";
import { cn } from "@/lib/cn";

/**
 * Persistent context banner showing which schema the operator is in, rendered
 * as an instrument path readout. SYSTEM is the most dangerous surface, so it
 * carries the hazard-tape signature on its leading edge; TENANT stays a solid
 * amber caution. Status is never colour-alone — always a label + path + words.
 */
export function SchemaBanner({ schema }: { schema: string | null }) {
  if (!schema) return null;
  const isSystem = schema === env().systemSchemaName;

  return (
    <div
      role="status"
      className={cn(
        "relative flex items-center gap-3 overflow-hidden px-4 py-2 text-sm",
        isSystem
          ? "bg-danger text-danger-foreground"
          : "bg-warning-strong text-warning-foreground",
      )}
    >
      {/* Hazard tape — reserved for the SYSTEM schema (most destructive). */}
      {isSystem && (
        <span
          aria-hidden="true"
          className="hazard-tape absolute inset-y-0 left-0 w-2"
        />
      )}

      <span
        className={cn(
          "rounded-sm px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em]",
          isSystem ? "bg-black/25" : "bg-black/15",
          isSystem && "ml-1.5",
        )}
      >
        {isSystem ? "System" : "Tenant"}
      </span>

      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[13px]">
        <span aria-hidden="true" className="opacity-60">
          ▸
        </span>
        <span className="truncate">{schema}</span>
      </span>

      <span className="eyebrow ml-auto shrink-0 text-inherit opacity-80">
        God Mode
        <span aria-hidden="true"> · </span>
        <span className="hidden sm:inline">Changes are permanent</span>
      </span>
    </div>
  );
}
