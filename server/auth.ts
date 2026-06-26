"use server";
import { redirect } from "next/navigation";
import { getSession, verifyPassword } from "@/lib/session";
import { verifySuperAdmin, type GatewayReason } from "@/lib/backend-api";

function messageFor(reason: GatewayReason): string {
  switch (reason) {
    case "invalid_credentials":
      return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    case "not_super_admin":
      return "บัญชีนี้ไม่มีสิทธิ์ super admin";
    case "gateway_unavailable":
      return "เชื่อมต่อ backend ไม่ได้ — ลองเข้าด้วย shared secret";
  }
}

export async function login(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const secret = String(formData.get("secret") ?? "");
  const actor = String(formData.get("actor") ?? "god").slice(0, 64) || "god";
  if (!verifyPassword(secret)) return { error: "รหัสลับไม่ถูกต้อง" };
  const session = await getSession();
  session.authed = true;
  session.actor = actor;
  session.method = "secret";
  await session.save();
  redirect("/schemas");
}

export async function gatewayLogin(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "กรอกชื่อผู้ใช้และรหัสผ่าน" };
  const result = await verifySuperAdmin(username, password);
  if (!result.ok) return { error: messageFor(result.reason) };
  const session = await getSession();
  session.authed = true;
  session.actor = result.actor.slice(0, 64);
  session.method = "gateway";
  await session.save();
  redirect("/schemas");
}

export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
