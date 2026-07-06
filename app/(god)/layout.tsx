import { Sidebar } from "@/components/sidebar";
import { TargetBar } from "@/components/target-bar";

export default function GodLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TargetBar />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
