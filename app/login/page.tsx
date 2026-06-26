"use client";
import { useActionState } from "react";
import { login } from "@/server/auth";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-semibold">God Mode</h1>
      <form action={action} className="space-y-3">
        <input name="actor" placeholder="Your name (for audit)" className="w-full rounded border p-2" />
        <input name="secret" type="password" placeholder="Shared secret" required className="w-full rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button type="submit" disabled={pending} className="w-full rounded bg-black p-2 text-white">
          {pending ? "…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
