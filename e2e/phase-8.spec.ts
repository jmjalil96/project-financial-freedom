import { expect, test } from "@playwright/test";

test("summarizes the latest trusted month and traces every decision fact", async ({
  page,
}, testInfo) => {
  const suffix = `r${testInfo.retry}`;
  const accountName = `Phase 8 decision cash ${suffix}`;
  const salaryDescription = `Phase 8 salary ${suffix}`;
  const expenseDescription = `Phase 8 groceries ${suffix}`;

  await page.goto("/");
  const onboardingCurrency = page.getByLabel("Reporting currency");
  if (await onboardingCurrency.isVisible().catch(() => false)) {
    await onboardingCurrency.selectOption("USD");
    await page.getByRole("button", { name: "Create local workspace" }).click();
  }

  await page.getByRole("link", { name: "Accounts" }).click();
  await page.getByLabel("Account name").fill(accountName);
  await page.getByLabel("Opening date").fill("2025-02-01");
  await page.getByLabel("Account type").selectOption("cash");
  await page.getByLabel("Opening balance").fill("500.00");
  await page.getByLabel(/Require this account for month close/).uncheck();
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(`${accountName} was added`)).toBeVisible();

  await page.getByRole("link", { name: "Transactions" }).click();
  await page
    .getByRole("group", { name: "Entry type" })
    .getByText("Income", { exact: true })
    .click();
  await page.getByLabel("Effective date").fill("2025-02-05");
  await page.getByLabel("Amount").fill("200.00");
  await page.getByLabel("Description").fill(salaryDescription);
  await page.getByLabel("Account").selectOption({ label: `${accountName} · Cash` });
  await page.getByLabel("Income category").selectOption({ label: "Salary" });
  await page.getByRole("button", { name: "Post balanced entry" }).click();
  await expect(page.getByRole("heading", { name: salaryDescription })).toBeVisible();

  await page.getByLabel("Effective date").fill("2025-02-10");
  await page.getByLabel("Amount").fill("50.00");
  await page.getByLabel("Description").fill(expenseDescription);
  await page.getByLabel("Account").selectOption({ label: `${accountName} · Cash` });
  await page.getByLabel("Expense category").selectOption({ label: "Groceries" });
  await page.getByRole("button", { name: "Post balanced entry" }).click();
  await expect(page.getByRole("heading", { name: expenseDescription })).toBeVisible();

  await page.goto("/month-close?month=2025-02");
  await expect(page.getByText("Ready to close", { exact: true })).toBeVisible();
  await page.getByLabel(/I reviewed the report/).check();
  await page.getByRole("button", { name: "Close month" }).click();
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();

  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", {
      name: "February 2025 is closed and explainable.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Current provisional month")).toBeVisible();

  const summary = page.getByRole("region", { name: "Financial summary" });
  const incomeCard = summary
    .getByRole("article")
    .filter({ has: page.getByText("Income", { exact: true }) });
  const expenseCard = summary
    .getByRole("article")
    .filter({ has: page.getByText("Expenses", { exact: true }) });
  const savingsCard = summary
    .getByRole("article")
    .filter({ has: page.getByText("Savings", { exact: true }) });
  await expect(incomeCard.locator(":scope > strong")).toHaveText("$200.00");
  await expect(expenseCard.locator(":scope > strong")).toHaveText("$50.00");
  await expect(savingsCard.locator(":scope > strong")).toHaveText("$150.00");

  const spending = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Largest spending categories" }),
  });
  await expect(spending).toContainText("Groceries");
  await expect(spending).toContainText("$50.00");

  const bridge = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Why the position changed" }),
  });
  await expect(bridge).toContainText("Income less expenses$150.00");
  await expect(bridge).toContainText("Other balance-sheet movement$500.00");
  await expect(
    page.getByRole("heading", { name: "Current monthly review" }),
  ).toBeVisible();

  await expenseCard.getByRole("link", { name: "Trace sources" }).click();
  await expect(page).toHaveURL(/\/month-close\?month=2025-02#spending-by-category$/);
  await page
    .locator("#spending-by-category")
    .getByText("Groceries", { exact: true })
    .click();
  await expect(
    page.locator("#spending-by-category").getByText(expenseDescription, {
      exact: true,
    }),
  ).toBeVisible();
});
