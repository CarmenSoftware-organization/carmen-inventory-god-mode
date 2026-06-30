import Link from "next/link";
import { SignOut } from "@phosphor-icons/react/dist/ssr";
import { logout } from "@/server/auth";
import { NavLink } from "@/components/nav-link";
import { dbTarget } from "@/lib/db-target";
import { cn } from "@/lib/cn";

const NAV: { href: string; label: string }[] = [
  { href: "/schemas", label: "Schemas" },
  { href: "/clusters", label: "Clusters" },
  { href: "/audit", label: "Audit log" },
  { href: "/platform-migrations", label: "Platform migrations" },
];

export default function GodLayout({ children }: { children: React.ReactNode }) {
  const target = dbTarget();
  const live = !target.isLocal;

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-30">
        <header className="flex h-14 items-center gap-2 border-b border-border bg-surface/80 px-4 backdrop-blur">
          <Link
            href="/schemas"
            className="mr-2 flex items-center gap-2.5"
            aria-label="Carmen God Mode — home"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-foreground font-display text-xs font-semibold text-background">
              C
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-display text-sm font-semibold tracking-tight text-foreground">
                CARMEN
              </span>
              <span className="font-display text-[10px] font-medium uppercase tracking-[0.18em] text-foreground-subtle">
                God&nbsp;Mode
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <form action={logout} className="ml-auto">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <SignOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </form>
        </header>

        {/*
          Target rail — the persistent reminder of WHERE the console is pointed.
          Calm when on a localhost target; danger-tinted with a breathing dot
          when pointed at a live system where every write is permanent.
        */}
        <div
          role="status"
          className={cn(
            "flex h-7 items-center gap-2.5 border-b px-4",
            live
              ? "border-danger-border bg-danger-subtle"
              : "border-border bg-surface",
          )}
        >
          <span className="target-dot shrink-0" data-live={live} aria-hidden="true" />
          <span className="eyebrow">Target</span>
          <span className="truncate font-mono text-[11px] text-foreground-muted">
            {target.host}
          </span>
          <span
            className={cn(
              "eyebrow ml-auto shrink-0",
              live && "text-danger",
            )}
          >
            {target.label}
            <span aria-hidden="true"> · </span>
            <span className="hidden sm:inline">Writes are permanent</span>
          </span>
        </div>
      </div>

      {/* Mobile nav row, kept on a single line. */}
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

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
