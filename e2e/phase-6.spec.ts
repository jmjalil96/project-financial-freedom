import { expect, test } from "@playwright/test";

test("adds and corrects a source-backed manual valuation", async ({
  page,
}, testInfo) => {
  const itemName = `Phase 6 vehicle r${testInfo.retry}`;
  await page.goto("/");
  const onboardingCurrency = page.getByLabel("Reporting currency");
  if (await onboardingCurrency.isVisible().catch(() => false)) {
    await onboardingCurrency.selectOption("USD");
    await page.getByRole("button", { name: "Create local workspace" }).click();
  }

  await page.getByRole("link", { name: "Net worth" }).click();
  await expect(page.getByRole("heading", { name: /Net worth at/ })).toBeVisible();
  await page.getByLabel("Item name").fill(itemName);
  await page.getByLabel("Classification").selectOption("asset");
  await page.getByLabel("Valuation frequency").selectOption("monthly");
  await page
    .getByLabel("Description")
    .fill("Synthetic vehicle used only for browser acceptance coverage.");
  await page.getByRole("button", { name: "Add manual item" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `${itemName} was added` }),
  ).toBeVisible();

  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: itemName, exact: true }),
  });
  await card.getByLabel("Value").fill("12500.00");
  await card.getByLabel("Source note").fill("Synthetic August market guide");
  await card.getByRole("button", { name: "Record valuation" }).click();
  await expect(
    card.getByRole("status").filter({ hasText: "dated valuation was recorded" }),
  ).toBeVisible();
  await expect(card).toContainText("$12,500.00");
  await expect(card).toContainText("Synthetic August market guide");

  await card.getByText("Record a dated value").click();
  await card.getByLabel("Value").fill("12000.00");
  await card.getByLabel("Source note").fill("Corrected synthetic market guide");
  await card.getByRole("button", { name: "Record valuation" }).click();
  await expect(card).toContainText("$12,000.00");
  await expect(card).toContainText("Corrected synthetic market guide");
});
