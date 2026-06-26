import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type SessionData = { authed: boolean; actor?: string; method?: "secret" | "gateway" };

export const sessionOptions: SessionOptions = {
  password: env().sessionSecret,
  cookieName: "godmode_session",
  cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export function verifyPassword(input: string): boolean {
  const a = Buffer.from(input ?? "", "utf8");
  const b = Buffer.from(env().godModePassword, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function assertAuthed(session: SessionData): void {
  if (!session.authed) throw new Error("Unauthorized");
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession();
  assertAuthed(session);
  return session;
}
