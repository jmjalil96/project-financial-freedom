import { expect, test, type Page } from "@playwright/test";

async function addAccount(
  page: Page,
  input: {
    name: string;
    type: "checking" | "savings";
    openingBalance: string;
  },
): Promise<void> {
  await page.getByRole("link", { name: "Accounts" }).click();
  await page.getByLabel("Account name").fill(input.name);
  await page.getByLabel("Opening date").fill("2026-08-01");
  await page.getByLabel("Account type").selectOption(input.type);
  await page.getByLabel("Opening balance").fill(input.openingBalance);
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(`${input.name} was added`)).toBeVisible();
}

async function importTransferStatement(
  page: Page,
  input: {
    accountLabel: string;
    amount: string;
    closingBalance: string;
    description: string;
    filename: string;
    openingBalance: string;
    transactionDate: string;
  },
): Promise<void> {
  await page.getByRole("link", { name: "Imports" }).click();
  const account = page.getByRole("combobox", { name: "Account", exact: true });
  await account.selectOption({ label: input.accountLabel });
  await page.getByLabel("Statement start").fill("2026-08-01");
  await page.getByLabel("Statement end").fill("2026-08-31");
  await page.getByLabel("Opening balance").fill(input.openingBalance);
  await page.getByLabel("Closing balance").fill(input.closingBalance);
  await page.getByLabel(/Choose a CSV file/).setInputFiles({
    name: input.filename,
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "transaction_date,posted_date,description,amount,currency,type",
        `${input.transactionDate},${input.transactionDate},${input.description},${input.amount},USD,transfer`,
      ].join("\n"),
    ),
  });
  await account.selectOption({ label: input.accountLabel });
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByRole("region", { name: input.filename })).toBeFocused();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /committed 1 source row atomically/i }),
  ).toBeVisible();

  const historyLink = page.getByRole("link").filter({
    has: page.getByRole("heading", { name: input.filename, exact: true }),
  });
  await historyLink.click();
  const row = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: input.description, exact: true }),
  });
  await row.getByText("Accept", { exact: true }).click();
  await row.getByLabel("Confirmed type").selectOption({ label: "Transfer" });
  await row.getByRole("button", { name: "Save row decision" }).click();
  await expect(
    row.getByRole("status").filter({ hasText: "The row decision was saved." }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Reconciliation equation" }),
  ).toContainText("Balanced");
  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Finalize reconciled statement" }).click();
  await expect(
    page.getByRole("heading", { name: "Statement sealed and posted" }),
  ).toBeVisible();
}

test("posts, matches, and covers independent owned-account transfer legs", async ({
  page,
}, testInfo) => {
  const suffix = `r${testInfo.retry}`;
  const checkingName = `Phase 5 transfer checking ${suffix}`;
  const savingsName = `Phase 5 transfer savings ${suffix}`;
  const outgoingDescription = `Phase 5 transfer out ${suffix}`;
  const incomingDescription = `Phase 5 transfer in ${suffix}`;

  await page.goto("/");
  const onboardingCurrency = page.getByLabel("Reporting currency");
  if (await onboardingCurrency.isVisible().catch(() => false)) {
    await onboardingCurrency.selectOption("USD");
    await page.getByRole("button", { name: "Create local workspace" }).click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  await addAccount(page, {
    name: checkingName,
    type: "checking",
    openingBalance: "500.00",
  });
  await addAccount(page, {
    name: savingsName,
    type: "savings",
    openingBalance: "0.00",
  });
  await importTransferStatement(page, {
    accountLabel: `${checkingName} · Checking`,
    amount: "-100.00",
    closingBalance: "400.00",
    description: outgoingDescription,
    filename: `phase-5-checking-${suffix}.csv`,
    openingBalance: "500.00",
    transactionDate: "2026-08-10",
  });
  await importTransferStatement(page, {
    accountLabel: `${savingsName} · Savings`,
    amount: "100.00",
    closingBalance: "100.00",
    description: incomingDescription,
    filename: `phase-5-savings-${suffix}.csv`,
    openingBalance: "0.00",
    transactionDate: "2026-08-11",
  });

  await page.getByRole("link", { name: "Transfers" }).click();
  const outgoing = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: outgoingDescription, exact: true }),
  });
  await outgoing.getByLabel("Match an owned-account leg").selectOption({ index: 1 });
  await outgoing.getByRole("button", { name: "Confirm match" }).click();
  await expect(page.getByText("Owned-account transfer", { exact: true })).toHaveCount(
    2,
  );
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(2);

  await page.getByRole("link", { name: "Coverage" }).click();
  for (const accountName of [checkingName, savingsName]) {
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: accountName, exact: true }),
    });
    await expect(card.getByText("Complete", { exact: true })).toBeVisible();
    await expect(card).toContainText("Aug 1, 2026 – Aug 31, 2026");
  }

  await page.getByRole("link", { name: "Transactions" }).click();
  for (const description of [outgoingDescription, incomingDescription]) {
    const entry = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: description, exact: true }),
    });
    await expect(entry).toContainText(/source row 2/i);
    await expect(entry).toContainText(/posted Aug 1[01], 2026/i);
  }

  if (process.env.PFF_E2E_FORCE_RETRY === "1" && testInfo.retry === 0) {
    throw new Error("Intentional first-attempt failure for retry-isolation coverage.");
  }
});
