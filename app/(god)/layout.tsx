import Link from "next/link";
import { logout } from "@/server/auth";

export default function GodLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="flex items-center gap-4 border-b px-4 py-2">
        <Link href="/schemas" className="font-semibold">Carmen God Mode</Link>
        <Link href="/clusters" className="text-sm text-gray-600">Clusters</Link>
        <Link href="/audit" className="text-sm text-gray-600">Audit log</Link>
        <Link href="/platform-migrations" className="text-sm text-gray-600">Platform migrations</Link>
        <form action={logout} className="ml-auto">
          <button className="text-sm text-gray-600">Log out</button>
        </form>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
