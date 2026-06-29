import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const pkgDir =
  process.env.PLATFORM_PACKAGE_DIR ??
  path.resolve(
    process.cwd(),
    "../carmen-turborepo-backend-v2/packages/prisma-shared-schema-platform",
  );

test.skip(
  !fs.existsSync(path.join(pkgDir, "package.json")),
  "platform package not present — set PLATFORM_PACKAGE_DIR or check out the sibling repo",
);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  // If the gateway tab is active (BACKEND_API_BASE_URL set), switch to the
  // shared-secret tab so input[name="actor"] / input[name="secret"] are visible.
  const sharedSecretTab = page.getByRole("button", { name: /Shared secret/i });
  await sharedSecretTab.click({ timeout: 3_000 }).catch(() => { /* gateway disabled: no shared-secret tab, already on the secret form */ });
  await page.fill('input[name="actor"]', "e2e");
  await page.fill('input[name="secret"]', process.env.GOD_MODE_PASSWORD!);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/schemas/);
}

test("runs read-only prisma migration status and streams output", async ({
  page,
}) => {
  await login(page);

  await page.goto("/platform-migrations");

  // The target banner reflects the selected schema (defaults to the system schema).
  await expect(page.getByText(/schema/i).first()).toBeVisible();

  // Select the read-only "Prisma: migration status" operation.
  await page.getByLabel(/Prisma: migration status/i).check();
  await page.getByRole("button", { name: /^Run$/i }).click();

  // The live log <pre role="log"> should appear and the run should finish.
  await expect(page.getByRole("log")).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText(
      /completed \(exit 0\)|Database schema is up to date|following migration/i,
    ),
  ).toBeVisible({ timeout: 60_000 });
});
