"use server";
import { redirect } from "next/navigation";
import { getSession, verifyPassword } from "@/lib/session";

export async function login(formData: FormData): Promise<void> {
  const secret = String(formData.get("secret") ?? "");
  const actor = String(formData.get("actor") ?? "god").slice(0, 64) || "god";
  if (!verifyPassword(secret)) throw new Error("Invalid secret");
  const session = await getSession();
  session.authed = true;
  session.actor = actor;
  await session.save();
  redirect("/schemas");
}

export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
