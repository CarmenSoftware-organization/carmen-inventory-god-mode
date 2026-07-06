import { TriangleAlert } from "lucide-react";
import { dbTarget } from "@/lib/db-target";
import { cn } from "@/lib/cn";

/**
 * The one deliberately un-platform-like element: a persistent bar naming the
 * database this console writes to. LOCAL is calm; LIVE is loud (danger fill +
 * "every write is permanent"), so god-mode is never mistaken for the everyday
 * platform. Meaning is carried by words + icon, never colour alone.
 */
export function TargetBar() {
  const target = dbTarget();
  const live = !target.isLocal;

  return (
    <div
      role="status"
      className={cn(
        "flex h-8 items-center gap-2 pl-14 pr-4 text-xs sm:pr-6 md:pl-6",
        live
          ? "bg-danger text-danger-foreground"
          : "bg-surface-muted text-foreground-muted",
      )}
    >
      {live && <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="font-semibold uppercase tracking-wider">{target.label}</span>
      <span aria-hidden="true" className="opacity-50">·</span>
      <span className="truncate font-mono">{target.host}</span>
      {live && (
        <span className="ml-auto hidden shrink-0 font-medium uppercase tracking-wider sm:inline">
          Every write is permanent
        </span>
      )}
      <span className="sr-only">
        {live ? "Live target — every write is permanent" : "Local target"}
      </span>
    </div>
  );
}
