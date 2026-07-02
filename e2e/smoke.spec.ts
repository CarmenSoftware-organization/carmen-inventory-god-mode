import { test, expect } from "@playwright/test";

test("unauthed user is redirected to login", async ({ page }) => {
  await page.goto("/schemas");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Register")).toBeVisible();
});
