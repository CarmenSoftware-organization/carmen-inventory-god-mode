import { env } from "@/lib/env";
import { LoginTabs } from "@/app/login/login-tabs";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-semibold">God Mode</h1>
      <LoginTabs gatewayEnabled={env().gatewayEnabled} />
    </main>
  );
}
