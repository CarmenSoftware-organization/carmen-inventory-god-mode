import { Sidebar } from "@/components/sidebar";
import { TargetBar } from "@/components/target-bar";

export default function GodLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TargetBar />
        <div className="flex-1 overflow-y-auto">
          <main className="w-full px-4 py-6 md:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
