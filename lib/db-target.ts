import { env } from "@/lib/env";

/**
 * The database this console is currently pointed at, in a form safe to render
 * in the chrome. Only the host:port is surfaced — credentials and database
 * name are never exposed. `isLocal` drives the "LIVE vs LOCAL" target rail:
 * a localhost target is calm; anything else is treated as a live system where
 * every write is permanent.
 */
export type DbTarget = {
  /** "host:port" of the active DATABASE_URL, or "unknown" if unparseable. */
  host: string;
  /** True for loopback hosts (localhost / 127.0.0.1 / ::1). */
  isLocal: boolean;
  /** Short label for the rail: "LOCAL" or "LIVE". */
  label: "LOCAL" | "LIVE";
};

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)$/i;

export function dbTarget(): DbTarget {
  let host = "unknown";
  try {
    const url = new URL(env().databaseUrl);
    host = url.host || url.hostname || "unknown";
  } catch {
    host = "unknown";
  }
  const hostname = host.split(":")[0];
  const isLocal = LOOPBACK.test(hostname);
  return { host, isLocal, label: isLocal ? "LOCAL" : "LIVE" };
}
