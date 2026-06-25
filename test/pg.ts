import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Pg = { stop: () => Promise<void> };

export async function startPg(): Promise<{ container: Pg; url: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const port = 5500 + Math.floor(Math.random() * 2500);
    const databaseDir = mkdtempSync(join(tmpdir(), "godmode-pg-"));
    const pg = new EmbeddedPostgres({ databaseDir, user: "postgres", password: "postgres", port, persistent: false });
    try {
      await pg.initialise();
      await pg.start();
      const url = `postgresql://postgres:postgres@localhost:${port}/postgres`;
      return { container: { stop: () => pg.stop() }, url };
    } catch (e) {
      lastErr = e;
      try { await pg.stop(); } catch { /* ignore */ }
    }
  }
  throw lastErr;
}
