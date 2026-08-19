import { expect, test } from "@playwright/test";

test("reviews, finalizes, and posts duplicate-aware statement evidence", async ({
  page,
}, testInfo) => {
  const suffix = `r${testInfo.retry}`;
  const checkingName = `Phase 4 checking ${suffix}`;
  const importFilename = `phase-4-statement-${suffix}.csv`;
  const expenseExternalId = `P4-EXPENSE-${suffix}`;
  const incomeExternalId = `P4-INCOME-${suffix}`;
  const canonicalExpense = `Phase 4 canonical expense ${suffix}`;
  const duplicateExpense = `Phase 4 duplicate expense ${suffix}`;
  const acceptedIncome = `Phase 4 accepted income ${suffix}`;
  const temporaryCategory = `Phase 4 temporary category ${suffix}`;

  await page.goto("/");
  const onboardingCurrency = page.getByLabel("Reporting currency");
  const freshWorkspace = await onboardingCurrency.isVisible().catch(() => false);

  if (freshWorkspace) {
    await onboardingCurrency.selectOption("USD");
    await page.getByRole("button", { name: "Create local workspace" }).click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("link", { name: "Accounts" }).click();
  await page.getByLabel("Account name").fill(checkingName);
  await page.getByLabel("Opening date").fill("2026-08-01");
  await page.getByLabel("Opening balance").fill("1000.00");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(`${checkingName} was added`)).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Category name").fill(temporaryCategory);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText(`${temporaryCategory} is ready to use.`)).toBeVisible();

  await page.getByRole("link", { name: "Imports" }).click();
  const importAccount = page.getByRole("combobox", {
    name: "Account",
    exact: true,
  });
  await importAccount.selectOption({ label: `${checkingName} · Checking` });
  await page.getByLabel("Statement start").fill("2026-08-01");
  await page.getByLabel("Statement end").fill("2026-08-31");
  await page.getByLabel("Opening balance").fill("1000.00");
  await page.getByLabel("Closing balance").fill("1075.00");

  const importFile = {
    name: importFilename,
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "transaction_date,posted_date,description,amount,currency,external_id,merchant,type,category,notes",
        `2026-08-04,2026-08-05,${canonicalExpense},-25.00,USD,${expenseExternalId},Phase Four Market,expense,${temporaryCategory},Canonical receipt ${suffix}`,
        `2026-08-04,2026-08-05,${duplicateExpense},-25.00,USD,${expenseExternalId},Phase Four Market,expense,${temporaryCategory},Duplicate receipt ${suffix}`,
        `2026-08-06,2026-08-06,${acceptedIncome},100.00,USD,${incomeExternalId},Phase Four Employer,income,Salary,Income evidence ${suffix}`,
      ].join("\n"),
    ),
  };
  await page.getByLabel(/Choose a CSV file/).setInputFiles(importFile);
  await importAccount.selectOption({ label: `${checkingName} · Checking` });
  await page.getByRole("button", { name: "Validate and preview" }).click();

  const preview = page.getByRole("region", { name: importFilename });
  await expect(preview).toBeFocused();
  await expect(
    preview.getByText(`External ID: ${expenseExternalId}`, { exact: true }),
  ).toHaveCount(2);
  await expect(
    preview.getByText(`External ID: ${incomeExternalId}`, { exact: true }),
  ).toBeVisible();
  await expect(preview.getByText("Entered close")).toBeVisible();

  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /committed 3 source rows atomically/i }),
  ).toBeVisible();

  const historyLink = page.getByRole("link").filter({
    has: page.getByRole("heading", { name: importFilename, exact: true }),
  });
  await expect(historyLink).toBeVisible();
  await historyLink.click();
  await expect(page).toHaveURL(/\/imports\/\d+\/review$/);
  await expect(
    page.getByRole("heading", { name: checkingName, exact: true }),
  ).toBeVisible();

  const sourceRow = (description: string) =>
    page.getByRole("article").filter({
      has: page.getByRole("heading", { name: description, exact: true }),
    });
  const canonicalRow = sourceRow(canonicalExpense);
  const duplicateRow = sourceRow(duplicateExpense);
  const incomeRow = sourceRow(acceptedIncome);

  await expect(canonicalRow).toHaveCount(1);
  await expect(duplicateRow).toHaveCount(1);
  await expect(incomeRow).toHaveCount(1);
  await expect(
    canonicalRow.getByText(expenseExternalId, { exact: true }),
  ).toBeVisible();
  await expect(
    canonicalRow.getByText(`Canonical receipt ${suffix}`, { exact: true }),
  ).toBeVisible();
  await expect(
    duplicateRow.getByText(expenseExternalId, { exact: true }),
  ).toBeVisible();
  await expect(
    duplicateRow.getByRole("region", { name: "Duplicate candidate evidence" }),
  ).toContainText(canonicalExpense);
  await expect(incomeRow.getByText(incomeExternalId, { exact: true })).toBeVisible();

  const reconciliation = page.getByRole("region", {
    name: "Reconciliation equation",
  });

  await canonicalRow.getByText("Accept", { exact: true }).click();
  await canonicalRow.getByLabel("Confirmed type").selectOption({ label: "Expense" });
  await canonicalRow
    .getByLabel("Category 1")
    .selectOption({ label: temporaryCategory });
  await canonicalRow.getByLabel("Amount").fill("25.00");
  await canonicalRow.getByRole("button", { name: "Save row decision" }).click();
  await expect(
    canonicalRow.getByRole("status").filter({
      hasText: "The row decision was saved.",
    }),
  ).toBeVisible();
  await expect(
    reconciliation.getByText("Difference open", { exact: true }),
  ).toBeVisible();
  await expect(reconciliation.getByText("$100.00", { exact: true })).toBeVisible();
  await expect(page.getByText(/minor units/i)).toHaveCount(0);

  const reviewUrl = page.url();
  await page.getByRole("link", { name: "Settings" }).click();
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.getByRole("button", { name: `Archive ${temporaryCategory}` }).click();
  await page.goto(reviewUrl);
  await expect(canonicalRow.getByLabel("Category 1")).toHaveValue("");
  await expect(
    canonicalRow.getByRole("option", {
      name: `Replace archived category: ${temporaryCategory}`,
    }),
  ).toBeAttached();
  await expect(
    canonicalRow.getByRole("button", { name: "Save row decision" }),
  ).toBeDisabled();
  await canonicalRow.getByLabel("Category 1").selectOption({ label: "Groceries" });
  await canonicalRow.getByRole("button", { name: "Save row decision" }).click();
  await expect(
    canonicalRow.getByRole("status").filter({
      hasText: "The row decision was saved.",
    }),
  ).toBeVisible();

  await duplicateRow.getByText("Duplicate", { exact: true }).click();
  await duplicateRow.getByText(`Row 2 · ${canonicalExpense}`, { exact: true }).click();
  await duplicateRow.getByRole("button", { name: "Save row decision" }).click();
  await expect(
    duplicateRow.getByRole("status").filter({
      hasText: "The row decision was saved.",
    }),
  ).toBeVisible();
  await expect(
    reconciliation.getByText("Difference open", { exact: true }),
  ).toBeVisible();

  await incomeRow.getByText("Accept", { exact: true }).click();
  await incomeRow.getByLabel("Confirmed type").selectOption({ label: "Income" });
  await incomeRow.getByLabel("Category 1").selectOption({ label: "Salary" });
  await incomeRow.getByLabel("Amount").fill("100.00");
  await incomeRow.getByRole("button", { name: "Save row decision" }).click();
  await expect(
    incomeRow.getByRole("status").filter({
      hasText: "The row decision was saved.",
    }),
  ).toBeVisible();

  await expect(reconciliation.getByText("Balanced", { exact: true })).toBeVisible();
  await expect(reconciliation.getByText("$0.00", { exact: true })).toBeVisible();
  await expect(reconciliation.getByText("Exact reconciliation")).toBeVisible();
  await expect(reconciliation).toContainText("$50.00");
  await expect(reconciliation).toContainText("$75.00");
  await expect(
    page.getByText("The equation and row evidence are ready for finalization."),
  ).toBeVisible();

  await expect(canonicalRow.getByText(canonicalExpense, { exact: true })).toBeVisible();
  await expect(duplicateRow.getByText(duplicateExpense, { exact: true })).toBeVisible();
  await expect(incomeRow.getByText(acceptedIncome, { exact: true })).toBeVisible();

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Finalize reconciled statement" }).click();

  const receipt = page.getByRole("region", { name: "Statement sealed" });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText(
    "The source evidence and review decisions are now read only.",
  );
  await expect(page.getByText("Finalized · read only", { exact: true })).toHaveCount(3);

  const saveButtons = page.getByRole("button", { name: "Save row decision" });
  await expect(saveButtons).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(saveButtons.nth(index)).toBeDisabled();
  }
  await expect(canonicalRow.getByRole("radio", { name: /^Accept\b/ })).toBeDisabled();
  await expect(
    duplicateRow.getByRole("radio", { name: /^Duplicate\b/ }),
  ).toBeDisabled();
  await expect(incomeRow.getByRole("radio", { name: /^Accept\b/ })).toBeDisabled();
  await expect(
    canonicalRow.getByText(expenseExternalId, { exact: true }),
  ).toBeVisible();
  await expect(
    duplicateRow.getByText(expenseExternalId, { exact: true }),
  ).toBeVisible();
  await expect(incomeRow.getByText(incomeExternalId, { exact: true })).toBeVisible();

  await page.goto("/transactions");
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  for (const importedDescription of [canonicalExpense, acceptedIncome]) {
    await expect(
      page.getByRole("heading", {
        name: importedDescription,
        exact: true,
      }),
    ).toHaveCount(1);
  }
  await expect(
    page.getByRole("heading", { name: duplicateExpense, exact: true }),
  ).toHaveCount(0);

  if (process.env.PFF_E2E_FORCE_RETRY === "1" && testInfo.retry === 0) {
    throw new Error("Intentional first-attempt failure for retry-isolation coverage.");
  }
});
