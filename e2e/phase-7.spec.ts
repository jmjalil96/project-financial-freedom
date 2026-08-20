import { expect, test } from "@playwright/test";

test("budgets, traces, closes, reopens, and preserves monthly revisions", async ({
  page,
}, testInfo) => {
  const suffix = `r${testInfo.retry}`;
  const accountName = `Phase 7 review cash ${suffix}`;
  const salaryDescription = `Phase 7 salary ${suffix}`;
  const expenseDescription = `Phase 7 groceries ${suffix}`;

  await page.goto("/");
  const onboardingCurrency = page.getByLabel("Reporting currency");
  if (await onboardingCurrency.isVisible().catch(() => false)) {
    await onboardingCurrency.selectOption("USD");
    await page.getByRole("button", { name: "Create local workspace" }).click();
  }

  await page.getByRole("link", { name: "Accounts" }).click();
  await page.getByLabel("Account name").fill(accountName);
  await page.getByLabel("Opening date").fill("2025-01-01");
  await page.getByLabel("Account type").selectOption("cash");
  await page.getByLabel("Opening balance").fill("1000.00");
  await page.getByLabel(/Require this account for month close/).uncheck();
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(`${accountName} was added`)).toBeVisible();

  await page.getByRole("link", { name: "Transactions" }).click();
  await page
    .getByRole("group", { name: "Entry type" })
    .getByText("Income", { exact: true })
    .click();
  await page.getByLabel("Effective date").fill("2025-01-05");
  await page.getByLabel("Amount").fill("100.00");
  await page.getByLabel("Description").fill(salaryDescription);
  await page.getByLabel("Account").selectOption({ label: `${accountName} · Cash` });
  await page.getByLabel("Income category").selectOption({ label: "Salary" });
  await page.getByRole("button", { name: "Post balanced entry" }).click();
  await expect(page.getByRole("heading", { name: salaryDescription })).toBeVisible();

  await page.getByLabel("Effective date").fill("2025-01-10");
  await page.getByLabel("Amount").fill("25.00");
  await page.getByLabel("Description").fill(expenseDescription);
  await page.getByLabel("Account").selectOption({ label: `${accountName} · Cash` });
  await page.getByLabel("Expense category").selectOption({ label: "Groceries" });
  await page.getByRole("button", { name: "Post balanced entry" }).click();
  await expect(page.getByRole("heading", { name: expenseDescription })).toBeVisible();

  await page.goto("/budgets?month=2025-01");
  await page.getByLabel("Groceries monthly target").fill("100.00");
  await page.getByRole("button", { name: "Save Groceries target" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "The monthly category target was saved without rollover.",
    }),
  ).toBeVisible();
  const budgetSummary = page.getByRole("region", { name: "Budget summary" });
  await expect(budgetSummary.getByText("$100.00", { exact: true })).toBeVisible();
  await expect(budgetSummary.getByText("$25.00", { exact: true })).toBeVisible();

  await page.goto("/month-close?month=2025-01");
  await expect(
    page.getByRole("heading", { name: "2025-01 financial close" }),
  ).toBeVisible();
  await expect(page.getByText("Ready to close", { exact: true })).toBeVisible();

  const report = page.getByRole("region", { name: "Monthly report summary" });
  const incomeCard = report
    .getByRole("article")
    .filter({ has: page.getByText("Income", { exact: true }) });
  const expenseCard = report
    .getByRole("article")
    .filter({ has: page.getByText("Expenses", { exact: true }) });
  const savingsCard = report
    .getByRole("article")
    .filter({ has: page.getByText("Savings", { exact: true }) });
  const budgetPlannedCard = report
    .getByRole("article")
    .filter({ has: page.getByText("Budget planned", { exact: true }) });
  const budgetActualCard = report
    .getByRole("article")
    .filter({ has: page.getByText("Budget actual", { exact: true }) });
  await expect(incomeCard.locator(":scope > strong")).toHaveText("$100.00");
  await expect(expenseCard.locator(":scope > strong")).toHaveText("$25.00");
  await expect(savingsCard.locator(":scope > strong")).toHaveText("$75.00");
  await expect(savingsCard).toContainText("75.0% savings rate");
  await expect(budgetPlannedCard.locator(":scope > strong")).toHaveText("$100.00");
  await expect(budgetActualCard.locator(":scope > strong")).toHaveText("$25.00");
  await expenseCard.getByText("Trace 1 source entries", { exact: true }).click();
  await expect(
    expenseCard.getByText(expenseDescription, { exact: true }),
  ).toBeVisible();

  await page.getByLabel(/I reviewed the report/).check();
  await page.getByRole("button", { name: "Close month" }).click();
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();
  await expect(page.getByText("Revision 1 · active", { exact: true })).toBeVisible();

  await page.goto("/budgets?month=2025-01");
  await expect(
    page.getByText("This budget is part of a closed report revision."),
  ).toBeVisible();
  await expect(page.getByLabel("Groceries monthly target")).toBeDisabled();

  await page.goto("/month-close?month=2025-01");
  await page.getByLabel("Reason for reopening").fill("Browser acceptance correction");
  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reopen month" }).click();
  await expect(page.getByText("Reopened", { exact: true })).toBeVisible();
  await expect(page.getByText("Revision 1", { exact: true })).toBeVisible();

  await page.getByLabel(/I reviewed the report/).check();
  await page.getByRole("button", { name: "Close month" }).click();
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();
  await expect(page.getByText("Revision 2 · active", { exact: true })).toBeVisible();
  await expect(page.getByText("Revision 1", { exact: true })).toBeVisible();
});
