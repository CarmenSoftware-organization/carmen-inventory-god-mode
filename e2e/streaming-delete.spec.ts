import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { login } from "./login";

// Happy-path e2e for the streaming cascade-delete flow. Fully self-contained:
// it seeds a throwaway, already-soft-deleted cluster directly in the DB, drives
// the hard-delete through the real UI (which streams progress over NDJSON), and
// asserts the stream's `done` event redirected back to /clusters with the row
// gone. The cluster has no business units, so the cascade drops NO tenant
// schemas — nothing on the live DB is touched except this disposable row.

const SCHEMA = process.env.SYSTEM_SCHEMA_NAME || "CARMEN_SYSTEM";
const CODE_PREFIX = "E2E_STREAM_";

function qualified(schema: string, table: string): string {
  return `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
}

function db() {
  return postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });
}

// Remove any cluster this spec created (current run or a previously-failed one).
async function cleanup(): Promise<void> {
  const sql = db();
  try {
    await sql.unsafe(`DELETE FROM ${qualified(SCHEMA, "tb_cluster")} WHERE code LIKE $1`, [`${CODE_PREFIX}%`]);
  } finally {
    await sql.end();
  }
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

test("hard-deleting a soft-deleted cluster streams progress and redirects to /clusters", async ({ page }) => {
  const code = `${CODE_PREFIX}${Date.now()}`;

  // Seed a throwaway cluster, already soft-deleted so it lands in the Deleted tab.
  const sql = db();
  let id: string;
  try {
    const rows = await sql.unsafe(
      `INSERT INTO ${qualified(SCHEMA, "tb_cluster")} (code, name, deleted_at)
       VALUES ($1, $2, now()) RETURNING id::text`,
      [code, "E2E streaming test"],
    );
    id = (rows[0] as unknown as { id: string }).id;
  } finally {
    await sql.end();
  }
  expect(id).toBeTruthy();

  await login(page);

  // Open the Deleted tab and confirm the seeded cluster is in the recycle bin.
  await page.goto("/clusters");
  await page.getByRole("tab", { name: /^Deleted/ }).click();
  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toBeVisible();

  // Navigate to the hard-delete confirm page via the row's link.
  await row.getByRole("link", { name: "Hard delete" }).click();
  await expect(page).toHaveURL(/\/tb_cluster\/delete\?/);

  // Confirm and submit — this drives the streaming /api/ops/cascade-delete route.
  await page.locator('input[name="confirm"]').fill("DELETE");
  // SealConfirm is a press-and-hold ceremony (~700ms), not a click: mousedown starts
  // the hold and mouseup cancels it, so a plain click always releases too early.
  const seal = page.getByRole("button", { name: "Confirm and permanently delete" });
  await seal.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_000);
  await page.mouse.up();

  // The redirect to /clusters only happens via the stream's `done` event, so
  // landing here proves the full stream → done → navigate path completed. And
  // the honesty contract means no rollback message on success.
  await expect(page).toHaveURL(/\/clusters$/, { timeout: 15_000 });
  await expect(page.getByText(/rolled back/i)).toHaveCount(0);

  // The cluster is gone from the recycle bin UI...
  await page.getByRole("tab", { name: /^Deleted/ }).click();
  await expect(page.getByText(code)).toHaveCount(0);

  // ...and from the database.
  const check = db();
  try {
    const left = await check.unsafe(
      `SELECT 1 FROM ${qualified(SCHEMA, "tb_cluster")} WHERE code = $1`, [code]);
    expect(left.length).toBe(0);
  } finally {
    await check.end();
  }
});
