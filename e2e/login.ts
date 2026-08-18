import { expect, type Page } from "@playwright/test";

/**
 * The one login used by every spec. It lived twice before, and when the
 * shared-secret tab was added only one copy learned to click it — the other spec
 * then hung on an input that was never on screen. Import this; do not re-copy it.
 */
export async function login(page: Page, actor = "e2e"): Promise<void> {
  await page.goto("/login");
  // With BACKEND_API_BASE_URL set the gateway tab is active, so input[name="actor"]
  // and input[name="secret"] are hidden until the shared-secret tab is selected.
  // That tab has role="tab" (not button), so getByRole("tab") is required.
  const sharedSecretTab = page.getByRole("tab", { name: /Shared secret/i });
  await sharedSecretTab.click({ timeout: 3_000 })
    .catch(() => { /* gateway disabled: no tabs, the secret form is already showing */ });
  await page.fill('input[name="actor"]', actor);
  await page.fill('input[name="secret"]', process.env.GOD_MODE_PASSWORD!);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/schemas/);
}
