"use client";
import { useActionState, useState } from "react";
import { login, gatewayLogin } from "@/server/auth";

type Tab = "gateway" | "secret";

export function LoginTabs({ gatewayEnabled }: { gatewayEnabled: boolean }) {
  const [tab, setTab] = useState<Tab>(gatewayEnabled ? "gateway" : "secret");
  const [gwState, gwAction, gwPending] = useActionState(gatewayLogin, {});
  const [secState, secAction, secPending] = useActionState(login, {});

  return (
    <div className="space-y-4">
      {gatewayEnabled && (
        <div className="flex gap-4 border-b text-sm">
          <button
            type="button"
            onClick={() => setTab("gateway")}
            className={tab === "gateway" ? "border-b-2 border-black pb-1 font-medium" : "pb-1 text-gray-500"}
          >
            Gateway login
          </button>
          <button
            type="button"
            onClick={() => setTab("secret")}
            className={tab === "secret" ? "border-b-2 border-black pb-1 font-medium" : "pb-1 text-gray-500"}
          >
            Shared secret
          </button>
        </div>
      )}

      {gatewayEnabled && tab === "gateway" && (
        <form action={gwAction} className="space-y-3">
          <input name="username" placeholder="Email or username" required className="w-full rounded border p-2" />
          <input name="password" type="password" placeholder="Password" required className="w-full rounded border p-2" />
          {gwState.error && <p role="alert" className="text-sm text-red-600">{gwState.error}</p>}
          <button type="submit" disabled={gwPending} className="w-full rounded bg-black p-2 text-white disabled:opacity-50">
            {gwPending ? "Signing in…" : "Enter"}
          </button>
        </form>
      )}

      {tab === "secret" && (
        <form action={secAction} className="space-y-3">
          <input name="actor" placeholder="Your name (for audit)" className="w-full rounded border p-2" />
          <input name="secret" type="password" placeholder="Shared secret" required className="w-full rounded border p-2" />
          {secState.error && <p role="alert" className="text-sm text-red-600">{secState.error}</p>}
          <button type="submit" disabled={secPending} className="w-full rounded bg-black p-2 text-white disabled:opacity-50">
            {secPending ? "Entering…" : "Enter"}
          </button>
        </form>
      )}
    </div>
  );
}
