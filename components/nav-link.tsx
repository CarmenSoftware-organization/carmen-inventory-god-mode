"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/** Sidebar navigation row. Active when the pathname equals or is under `href`. */
export function NavLink({
  href,
  label,
  icon: Icon,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  collapsed?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        active
          ? "bg-surface-hover text-foreground"
          : "text-foreground-muted hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
