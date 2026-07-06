import { env } from "@/lib/env";
import { cn } from "@/lib/cn";

/**
 * Persistent context band showing which schema the operator is in.
 * SYSTEM renders as a danger fill, TENANT as an amber fill. Status is never
 * colour-alone — always a label + path + words.
 */
export function SchemaBanner({ schema }: { schema: string | null }) {
  if (!schema) return null;
  const isSystem = schema === env().systemSchemaName;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 px-4 py-2 text-sm",
        isSystem
          ? "bg-danger text-danger-foreground"
          : "bg-warning-strong text-warning-foreground",
      )}
    >
      <span
        className={cn(
          "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
          isSystem ? "bg-black/25" : "bg-black/15",
        )}
      >
        {isSystem ? "System" : "Tenant"}
      </span>

      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[13px]">
        <span aria-hidden="true" className="opacity-60">▸</span>
        <span className="truncate">{schema}</span>
      </span>

      <span className="ml-auto shrink-0 text-xs font-medium uppercase tracking-wider opacity-80">
        <span className="hidden sm:inline">Changes are permanent</span>
      </span>
    </div>
  );
}
