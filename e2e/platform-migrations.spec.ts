import { test, expect } from "@playwright/test";
import { login } from "./login";
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
