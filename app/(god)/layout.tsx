import { Database, Boxes, ScrollText, GitBranch } from "lucide-react";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { TargetBar } from "@/components/target-bar";

const NAV: NavItem[] = [
  { href: "/schemas", label: "Schemas", icon: Database },
  { href: "/clusters", label: "Clusters", icon: Boxes },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/platform-migrations", label: "Migrations", icon: GitBranch },
];

export default function GodLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar items={NAV} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TargetBar />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
