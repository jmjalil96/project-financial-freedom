import { expect, test } from "@playwright/test";

test("completes setup, ledger workflows, corrections, and a CSV import", async ({
  page,
}, testInfo) => {
  const suffix = `r${testInfo.retry}`;
  const checkingName = `Everyday checking ${suffix}`;
  const savingsName = `Savings ${suffix}`;
  const salaryDescription = `Salary payment ${suffix}`;
  const refundDescription = `Grocery refund ${suffix}`;
  const importFilename = `august-${suffix}.csv`;

  await page.goto("/");
  const onboardingCurrency = page.getByLabel("Reporting currency");
  const freshWorkspace = await onboardingCurrency.isVisible().catch(() => false);

  if (freshWorkspace) {
    await onboardingCurrency.selectOption("USD");
    await page.getByRole("button", { name: "Create local workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("link", { name: "Settings" }).click();
    const reportingCurrency = page.getByLabel("Reporting currency");
    await reportingCurrency.selectOption("EUR");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Reporting currency changed to EUR.")).toBeVisible();
    await reportingCurrency.selectOption("USD");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Reporting currency changed to USD.")).toBeVisible();
  } else {
    await expect(page).toHaveURL(/\/dashboard$/);
  }

  await page.getByRole("link", { name: "Accounts" }).click();
  await page.getByLabel("Account name").fill(checkingName);
  await page.getByLabel("Opening date").fill("2026-08-01");
  await page.getByLabel("Opening balance").fill("not-money");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(/plain decimal amount/i)).toBeVisible();
  await expect(page.getByLabel("Account name")).toHaveValue(checkingName);
  await expect(page.getByLabel("Opening date")).toHaveValue("2026-08-01");
  await expect(page.getByLabel("Opening balance")).toHaveValue("not-money");

  await page.getByLabel("Opening balance").fill("1000.00");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(`${checkingName} was added`)).toBeVisible();
  await expect(page.getByLabel("Account type")).toHaveValue("checking");

  await page.getByLabel("Account name").fill(savingsName);
  await page.getByLabel("Opening date").fill("2026-08-01");
  await page.getByLabel("Opening balance").fill("0.00");
  await page.getByLabel("Account type").selectOption("savings");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(`${savingsName} was added`)).toBeVisible();

  await page.getByRole("link", { name: "Transactions" }).click();
  await page.getByLabel("Effective date").fill("2026-07-31");
  await page.getByLabel("Amount").fill("10.00");
  await page.getByLabel("Description").fill("Too early");
  await page
    .getByLabel("Account")
    .selectOption({ label: `${checkingName} · Checking` });
  await page.getByLabel("Expense category").selectOption({ label: "Groceries" });
  await page.getByRole("button", { name: "Post balanced entry" }).click();
  await expect(
    page.getByText(/transaction date cannot be before .* opening date/i),
  ).toBeVisible();
  await expect(page.getByLabel("Effective date")).toHaveValue("2026-07-31");
  await expect(page.getByLabel("Amount")).toHaveValue("10.00");
  await expect(page.getByLabel("Description")).toHaveValue("Too early");
  await expect(page.getByLabel("Account")).not.toHaveValue("");
  await expect(page.getByLabel("Expense category")).not.toHaveValue("");

  await page
    .getByRole("group", { name: "Entry type" })
    .getByText("Income", { exact: true })
    .click();
  await expect(page.getByLabel("Income category")).toHaveValue("");
  await page.getByLabel("Effective date").fill("2026-08-02");
  await page.getByLabel("Amount").fill("100.00");
  await page.getByLabel("Description").fill(salaryDescription);
  await page
    .getByLabel("Account")
    .selectOption({ label: `${checkingName} · Checking` });
  await page.getByLabel("Income category").selectOption({ label: "Salary" });
  await page.getByRole("button", { name: "Post balanced entry" }).click();
  await expect(page.getByText("The balanced journal entry was posted.")).toBeVisible();
  await expect(page.getByRole("heading", { name: salaryDescription })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Expense", exact: true })).toBeChecked();
  await expect(page.getByLabel("Account")).toHaveValue("");

  await page
    .getByRole("group", { name: "Entry type" })
    .getByText("Transfer", { exact: true })
    .click();
  await page
    .getByLabel("From account")
    .selectOption({ label: `${checkingName} · Checking` });
  await page
    .getByLabel("To account")
    .selectOption({ label: `${savingsName} · Savings` });
  await page
    .getByLabel("From account")
    .selectOption({ label: `${savingsName} · Savings` });
  await expect(page.getByLabel("To account")).toHaveValue("");

  await page
    .getByRole("group", { name: "Entry type" })
    .getByText("Expense refund", { exact: true })
    .click();
  await page.getByLabel("Effective date").fill("2026-08-03");
  await page.getByLabel("Amount").fill("5.00");
  await page.getByLabel("Description").fill(refundDescription);
  await page
    .getByLabel("Account")
    .selectOption({ label: `${checkingName} · Checking` });
  await page.getByLabel("Original expense category").selectOption({
    label: "Groceries",
  });
  await page.getByRole("button", { name: "Post balanced entry" }).click();
  await expect(page.getByRole("heading", { name: refundDescription })).toBeVisible();

  const refundCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: refundDescription }) });
  await refundCard.getByText("Reverse entry").click();
  await refundCard.getByLabel("Reason").fill("Duplicate refund");
  await refundCard.getByRole("button", { name: "Post balanced reversal" }).click();
  await expect(refundCard.getByText("reversed", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Imports" }).click();
  const importAccount = page.getByRole("combobox", {
    name: "Account",
    exact: true,
  });
  await expect(importAccount).toHaveValue("");
  await importAccount.selectOption({ label: `${checkingName} · Checking` });
  await page.getByLabel("Statement start").fill("2026-08-01");
  await page.getByLabel("Statement end").fill("2026-08-31");
  await page.getByLabel("Opening balance").fill("1000.00");
  await page.getByLabel("Closing balance").fill("990.00");
  const importFile = {
    name: importFilename,
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "transaction_date,posted_date,description,amount,currency,external_id,merchant,type,category,notes",
        `2026-08-04,2026-08-05,MARKET,-10.00,USD,TX-${suffix},Market,expense,Groceries,Receipt checked`,
      ].join("\n"),
    ),
  };
  await page.getByLabel(/Choose a CSV file/).setInputFiles(importFile);
  await importAccount.selectOption({ label: `${checkingName} · Checking` });
  await expect(importAccount).not.toHaveValue("");
  await page.route("**/imports", async (route) => {
    if (route.request().method() === "POST") {
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByText(/preview request did not complete/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Validate and preview" }),
  ).toBeEnabled();
  await page.unroute("**/imports");

  await page.getByRole("button", { name: "Validate and preview" }).click();
  const preview = page.getByRole("region", { name: importFilename });
  await expect(preview).toBeFocused();
  await expect(page.getByRole("heading", { name: importFilename })).toBeVisible();
  await expect(page.getByText(`External ID: TX-${suffix}`)).toBeVisible();
  await expect(page.getByText("Merchant: Market")).toBeVisible();
  await expect(page.getByText("Notes: Receipt checked")).toBeVisible();
  await expect(page.getByText("Effective: 2026-08-05")).toBeVisible();
  await expect(page.getByText(/retention and privacy policy/)).toBeVisible();

  await page.route("**/imports", async (route) => {
    if (route.request().method() === "POST") {
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText(/commit request did not complete/i)).toBeVisible();
  await page.unroute("**/imports");
  await expect(
    page.getByRole("button", { name: "Validate and preview" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Validate and preview" }).click();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Import #\d+ committed 1 source row atomically\./ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: importFilename })).toBeVisible();

  await importAccount.selectOption({ label: `${checkingName} · Checking` });
  await page.getByLabel("Statement start").fill("2026-08-01");
  await page.getByLabel("Statement end").fill("2026-08-31");
  await page.getByLabel("Opening balance").fill("1000.00");
  await page.getByLabel("Closing balance").fill("990.00");
  await page.getByLabel(/Choose a CSV file/).setInputFiles(importFile);
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByText(/exact file was already committed/i)).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Category name").fill("   ");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Enter a category name.")).toBeVisible();
  await expect(page.getByLabel("Category name")).toHaveValue("   ");
  await page.getByLabel("Category name").fill(`食品 ${suffix}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText(`食品 ${suffix} is ready to use.`)).toBeVisible();
  await page.goto("/toString");
  await expect(
    page.getByRole("heading", {
      name: "This page is not part of the monthly workspace.",
    }),
  ).toBeVisible();

  if (process.env.PFF_E2E_FORCE_RETRY === "1" && testInfo.retry === 0) {
    throw new Error("Intentional first-attempt failure for retry-isolation coverage.");
  }
});
