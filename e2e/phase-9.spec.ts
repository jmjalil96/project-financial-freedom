import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test("exports, previews, and restores a verified local snapshot", async ({ page }) => {
  await page.goto("/");
  const onboardingCurrency = page.getByLabel("Reporting currency");
  if (await onboardingCurrency.isVisible().catch(() => false)) {
    await onboardingCurrency.selectOption("USD");
    await page.getByRole("button", { name: "Create local workspace" }).click();
  }

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Open data safety" }).click();
  await expect(
    page.getByRole("heading", { name: "Back up, export, and restore deliberately." }),
  ).toBeVisible();
  await expect(
    page.getByText("These downloads contain private financial history."),
  ).toBeVisible();

  const jsonDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const jsonDownload = await jsonDownloadEvent;
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).not.toBeNull();
  const portable = JSON.parse(await readFile(jsonPath!, "utf8")) as {
    format: string;
    baseCurrency: string;
    dataChecksum: string;
    tables: Record<string, unknown[]>;
  };
  expect(portable).toMatchObject({
    format: "project-financial-freedom-portable-v1",
    baseCurrency: "USD",
  });
  expect(portable.dataChecksum).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(portable.tables)).toHaveLength(19);

  const sqliteDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SQLite" }).click();
  const sqliteDownload = await sqliteDownloadEvent;
  const sqlitePath = await sqliteDownload.path();
  expect(sqlitePath).not.toBeNull();
  const sqliteBytes = await readFile(sqlitePath!);
  expect(sqliteBytes.subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");

  await page.getByRole("button", { name: "Create verified backup" }).click();
  await expect(page.getByText(/was created and verified/)).toBeVisible();
  await page.getByRole("link", { name: "Inspect restore" }).first().click();
  await expect(
    page.getByText("Verified restore preview", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Integrity checks pass")).toBeVisible();
  await expect(page.getByText(/^SHA-256 /)).toBeVisible();

  await page
    .getByLabel(/I understand that live changes newer than this snapshot/)
    .check();
  await page.getByLabel(/Type RESTORE/).fill("RESTORE");
  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restore this snapshot" }).click();
  await expect(page.getByText(/was restored successfully/)).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
});
