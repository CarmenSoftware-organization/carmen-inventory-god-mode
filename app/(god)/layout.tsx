import Link from "next/link";
import { SignOut } from "@phosphor-icons/react/dist/ssr";
import { logout } from "@/server/auth";
import { NavLink } from "@/components/nav-link";
import { dbTarget } from "@/lib/db-target";
import { cn } from "@/lib/cn";

const NAV: { href: string; label: string }[] = [
  { href: "/schemas", label: "Schemas" },
  { href: "/clusters", label: "Clusters" },
  { href: "/audit", label: "Record" },
  { href: "/platform-migrations", label: "Amendments" },
];

export default function GodLayout({ children }: { children: React.ReactNode }) {
  const target = dbTarget();
  const live = !target.isLocal;

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-30 bg-surface/85 backdrop-blur">
        <header className="flex h-14 items-center gap-3 px-4">
          <Link
            href="/schemas"
            className="mr-1 flex items-baseline gap-2"
            aria-label="The Register of Carmen — home"
          >
            <span className="font-display text-lg font-medium tracking-tight text-foreground">
              CARMEN
            </span>
            <span className="rubric rubric-seal">Register</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div
            role="status"
            className={cn(
              "ml-auto hidden items-center gap-2.5 sm:flex",
              live ? "text-danger" : "text-foreground-subtle",
            )}
          >
            <span className="rubric">Target</span>
            <span className="font-mono text-[11px] text-foreground-muted">
              {target.host}
            </span>
            <span className="seal" data-live={live} aria-hidden="true">
              {live ? "Live" : "Local"}
            </span>
            <span className="sr-only">
              {live ? "Live target — writes are permanent" : "Local target"}
            </span>
          </div>

          <form action={logout} className="ml-auto sm:ml-0">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <SignOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </form>
        </header>

        {/* The ledger's running rule — draws once on load (Task 11 adds motion). */}
        <div className={cn("rule-double", live && "bg-danger-subtle")} aria-hidden="true" />

        {/* Mobile target row — the persistent "where is this pointed" reminder. */}
        <div
          role="status"
          className={cn(
            "flex h-7 items-center gap-2 px-4 sm:hidden",
            live ? "bg-danger-subtle text-danger" : "bg-surface",
          )}
        >
          <span className="seal !h-4 !w-4 !text-[7px]" data-live={live} aria-hidden="true">
            {live ? "L" : "·"}
          </span>
          <span className="rubric">Target</span>
          <span className="truncate font-mono text-[11px] text-foreground-muted">
            {target.host}
          </span>
          <span className={cn("rubric ml-auto shrink-0", live && "text-danger")}>
            {target.label}
          </span>
        </div>
      </div>

      {/* Mobile nav row. */}
      <nav
        className="flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-4 py-2 md:hidden"
        aria-label="Primary"
      >
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-6">
        {children}
      </main>
    </div>
  );
}
