import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseContext } from "@/db/runtime";
import {
  archiveFinancialAccount,
  createFinancialAccount,
  listFinancialAccounts,
  restoreFinancialAccount,
} from "@/features/accounts/account-service";
import {
  archiveCategory,
  createCategory,
  listCategories,
  restoreCategory,
} from "@/features/categories/category-service";
import {
  postJournalEntry,
  reverseJournalEntry,
} from "@/features/ledger/ledger-service";
import { saveBaseCurrency } from "@/features/settings/settings-repository";
import { createManualTransaction } from "@/features/transactions/manual-transaction-service";
import {
  createIsolatedDatabase,
  destroyIsolatedDatabase,
} from "../../../test-fixtures/database-test-context";

let context: DatabaseContext;
let temporaryRoot: string;

function ledgerAccountIdForFinancialAccount(name: string): number {
  const row = context.raw
    .prepare(
      `SELECT la.id
       FROM ledger_accounts la
       JOIN financial_accounts fa ON fa.id = la.financial_account_id
       WHERE fa.name = ?`,
    )
    .get(name) as { id: number };

  return row.id;
}

function ledgerAccountIdForCategory(name: string): number {
  const row = context.raw
    .prepare(
      `SELECT la.id
       FROM ledger_accounts la
       JOIN categories c ON c.id = la.category_id
       WHERE c.name = ?`,
    )
    .get(name) as { id: number };

  return row.id;
}

beforeEach(async () => {
  ({ context, temporaryRoot } = await createIsolatedDatabase("pff-ledger-test-"));
  context.raw
    .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
    .run();
});

afterEach(() => {
  destroyIsolatedDatabase(context, temporaryRoot);
});

describe("Phase 2 ledger foundation", () => {
  it("seeds the system accounts and flat default categories idempotently", async () => {
    const systemAccounts = context.raw
      .prepare(
        "SELECT system_key FROM ledger_accounts WHERE system_key IS NOT NULL ORDER BY system_key",
      )
      .all() as Array<{ system_key: string }>;
    const categoryCount = context.raw
      .prepare("SELECT count(*) AS count FROM categories")
      .get() as { count: number };
    const categoryLedgerCount = context.raw
      .prepare(
        "SELECT count(*) AS count FROM ledger_accounts WHERE category_id IS NOT NULL",
      )
      .get() as { count: number };

    expect(systemAccounts.map((account) => account.system_key)).toEqual([
      "manual_adjustments",
      "opening_equity",
      "outside_scope_transfers",
      "transfer_clearing",
    ]);
    expect(categoryCount.count).toBe(15);
    expect(categoryLedgerCount.count).toBe(15);
    expect(context.health.appliedMigrations).toBe(16);
  });

  it("creates asset and liability opening positions without income or expense", async () => {
    await createFinancialAccount({
      name: "Checking",
      institution: "Local Bank",
      type: "checking",
      openingDate: "2026-07-31",
      openingBalanceMinor: 200000,
      requiredForClose: true,
    });
    await createFinancialAccount({
      name: "Visa",
      institution: "Local Bank",
      type: "credit_card",
      openingDate: "2026-07-31",
      openingBalanceMinor: 50000,
      requiredForClose: true,
    });

    const accounts = await listFinancialAccounts();
    const checking = accounts.find((account) => account.name === "Checking");
    const visa = accounts.find((account) => account.name === "Visa");
    const categoryPostings = context.raw
      .prepare(
        `SELECT count(*) AS count
         FROM postings p
         JOIN ledger_accounts la ON la.id = p.ledger_account_id
         WHERE la.kind IN ('income', 'expense')`,
      )
      .get() as { count: number };
    const unbalancedEntries = context.raw
      .prepare(
        `SELECT p.journal_entry_id
         FROM postings p
         GROUP BY p.journal_entry_id
         HAVING sum(p.amount_minor) != 0`,
      )
      .all();

    expect(checking?.balanceMinor).toBe(200000);
    expect(visa?.balanceMinor).toBe(-50000);
    expect(categoryPostings.count).toBe(0);
    expect(unbalancedEntries).toHaveLength(0);
  });

  it("allows correcting base currency before financial data exists", async () => {
    await saveBaseCurrency("EUR");

    const settings = context.raw
      .prepare("SELECT base_currency FROM app_settings WHERE id = 1")
      .get() as { base_currency: string };
    const audit = context.raw
      .prepare(
        `SELECT action, details_json
         FROM audit_events
         WHERE entity_type = 'application_settings'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get() as { action: string; details_json: string };

    expect(settings.base_currency).toBe("EUR");
    expect(audit.action).toBe("settings.base_currency_changed");
    expect(JSON.parse(audit.details_json)).toMatchObject({
      previousBaseCurrency: "USD",
      baseCurrency: "EUR",
    });
  });

  it("audits initial base-currency setup", async () => {
    context.raw.prepare("DELETE FROM app_settings WHERE id = 1").run();

    await saveBaseCurrency("COP");

    expect(
      context.raw
        .prepare(
          `SELECT action
           FROM audit_events
           WHERE entity_type = 'application_settings'`,
        )
        .get(),
    ).toEqual({ action: "settings.base_currency_initialized" });
  });

  it("rejects reconstructing missing currency settings around existing data", async () => {
    context.raw.prepare("DELETE FROM app_settings WHERE id = 1").run();
    context.raw
      .prepare(
        `INSERT INTO financial_accounts (name, type, currency, opening_date)
         VALUES ('Orphaned account', 'checking', 'USD', '2026-08-01')`,
      )
      .run();

    await expect(saveBaseCurrency("EUR")).rejects.toThrow(
      "settings are missing while financial data exists",
    );
    expect(
      context.raw.prepare("SELECT count(*) AS count FROM app_settings").get(),
    ).toEqual({ count: 0 });
  });

  it("freezes and preserves base currency after financial data exists", async () => {
    await createFinancialAccount({
      name: "Checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });

    await expect(saveBaseCurrency("EUR")).rejects.toThrow(
      "cannot be changed after financial data",
    );
    expect(() =>
      context.raw
        .prepare("UPDATE app_settings SET base_currency = 'EUR' WHERE id = 1")
        .run(),
    ).toThrow("base currency cannot change");
    expect(() =>
      context.raw.prepare("DELETE FROM app_settings WHERE id = 1").run(),
    ).toThrow("base currency settings cannot be deleted");
  });

  it("rejects unbalanced entries at both service and database boundaries", async () => {
    await createFinancialAccount({
      name: "Cash",
      type: "cash",
      openingDate: "2026-08-01",
      openingBalanceMinor: 0,
      requiredForClose: false,
    });
    const cashLedgerId = ledgerAccountIdForFinancialAccount("Cash");
    const groceriesLedgerId = ledgerAccountIdForCategory("Groceries");

    await expect(
      postJournalEntry({
        effectiveDate: "2026-08-02",
        description: "Invalid imbalance",
        sourceType: "manual",
        postings: [
          { ledgerAccountId: cashLedgerId, amountMinor: -1000 },
          { ledgerAccountId: groceriesLedgerId, amountMinor: 900 },
        ],
      }),
    ).rejects.toThrow("must balance exactly to zero");

    const draft = context.raw
      .prepare(
        `INSERT INTO journal_entries
          (effective_date, description, source_type)
         VALUES ('2026-08-02', 'Database imbalance', 'manual')`,
      )
      .run();
    const draftId = Number(draft.lastInsertRowid);

    context.raw
      .prepare(
        `INSERT INTO postings
          (journal_entry_id, ledger_account_id, amount_minor)
         VALUES (?, ?, -1000), (?, ?, 900)`,
      )
      .run(draftId, cashLedgerId, draftId, groceriesLedgerId);

    expect(() =>
      context.raw
        .prepare(
          `UPDATE journal_entries
           SET is_posted = 1, posted_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(draftId),
    ).toThrow("must balance to zero");
  });

  it("records a card payment as a transfer with no income or expense", async () => {
    const checkingId = await createFinancialAccount({
      name: "Checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 100000,
      requiredForClose: true,
    });
    const visaId = await createFinancialAccount({
      name: "Visa",
      type: "credit_card",
      openingDate: "2026-08-01",
      openingBalanceMinor: 50000,
      requiredForClose: true,
    });

    await createManualTransaction({
      kind: "transfer",
      effectiveDate: "2026-08-10",
      description: "Visa payment",
      amountMinor: 20000,
      financialAccountId: checkingId,
      destinationFinancialAccountId: visaId,
    });

    const accounts = await listFinancialAccounts();
    const checking = accounts.find((account) => account.id === checkingId);
    const visa = accounts.find((account) => account.id === visaId);
    const categoryPostings = context.raw
      .prepare(
        `SELECT count(*) AS count
         FROM postings p
         JOIN journal_entries je ON je.id = p.journal_entry_id
         JOIN ledger_accounts la ON la.id = p.ledger_account_id
         WHERE je.description = 'Visa payment'
           AND la.kind IN ('income', 'expense')`,
      )
      .get() as { count: number };

    expect(checking?.balanceMinor).toBe(80000);
    expect(visa?.balanceMinor).toBe(-30000);
    expect((checking?.balanceMinor ?? 0) + (visa?.balanceMinor ?? 0)).toBe(50000);
    expect(categoryPostings.count).toBe(0);
  });

  it("supports refunds and split expenses through balanced postings", async () => {
    await createFinancialAccount({
      name: "Checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 100000,
      requiredForClose: true,
    });
    const visaId = await createFinancialAccount({
      name: "Visa",
      type: "credit_card",
      openingDate: "2026-08-01",
      openingBalanceMinor: 40000,
      requiredForClose: true,
    });
    const checkingLedgerId = ledgerAccountIdForFinancialAccount("Checking");
    const visaLedgerId = ledgerAccountIdForFinancialAccount("Visa");
    const groceriesLedgerId = ledgerAccountIdForCategory("Groceries");
    const shoppingLedgerId = ledgerAccountIdForCategory("Shopping");

    await createManualTransaction({
      kind: "refund",
      effectiveDate: "2026-08-12",
      description: "Grocery refund",
      amountMinor: 2000,
      financialAccountId: visaId,
      categoryId: (await listCategories()).find(
        (category) => category.name === "Groceries",
      )!.id,
    });
    await postJournalEntry({
      effectiveDate: "2026-08-18",
      description: "Split store purchase",
      sourceType: "manual",
      postings: [
        { ledgerAccountId: checkingLedgerId, amountMinor: -12000 },
        { ledgerAccountId: groceriesLedgerId, amountMinor: 9000 },
        { ledgerAccountId: shoppingLedgerId, amountMinor: 3000 },
      ],
    });

    const balances = context.raw
      .prepare(
        `SELECT la.name, sum(p.amount_minor) AS balance
         FROM postings p
         JOIN ledger_accounts la ON la.id = p.ledger_account_id
         JOIN journal_entries je ON je.id = p.journal_entry_id
         WHERE je.is_posted = 1
           AND la.id IN (?, ?, ?, ?)
         GROUP BY la.id`,
      )
      .all(
        checkingLedgerId,
        visaLedgerId,
        groceriesLedgerId,
        shoppingLedgerId,
      ) as Array<{ name: string; balance: number }>;
    const balanceByName = new Map(
      balances.map((balance) => [balance.name, balance.balance]),
    );

    expect(balanceByName.get("Checking")).toBe(88000);
    expect(balanceByName.get("Visa")).toBe(-38000);
    expect(balanceByName.get("Groceries")).toBe(7000);
    expect(balanceByName.get("Shopping")).toBe(3000);
  });

  it("posts salary, loan principal, and loan interest with distinct semantics", async () => {
    const checkingId = await createFinancialAccount({
      name: "Checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 200000,
      requiredForClose: true,
    });
    const loanId = await createFinancialAccount({
      name: "Student loan",
      type: "loan",
      openingDate: "2026-08-01",
      openingBalanceMinor: 50000,
      requiredForClose: true,
    });
    const categories = await listCategories();
    const salaryId = categories.find((category) => category.name === "Salary")!.id;
    const interestId = categories.find(
      (category) => category.name === "Debt interest",
    )!.id;

    await createManualTransaction({
      kind: "income",
      effectiveDate: "2026-08-02",
      description: "Monthly salary",
      amountMinor: 300000,
      financialAccountId: checkingId,
      categoryId: salaryId,
    });
    await createManualTransaction({
      kind: "transfer",
      effectiveDate: "2026-08-05",
      description: "Loan principal payment",
      amountMinor: 10000,
      financialAccountId: checkingId,
      destinationFinancialAccountId: loanId,
    });
    await createManualTransaction({
      kind: "expense",
      effectiveDate: "2026-08-06",
      description: "Loan interest charge",
      amountMinor: 500,
      financialAccountId: loanId,
      categoryId: interestId,
    });

    const accounts = await listFinancialAccounts();
    expect(accounts.find((account) => account.id === checkingId)?.balanceMinor).toBe(
      490000,
    );
    expect(accounts.find((account) => account.id === loanId)?.balanceMinor).toBe(
      -40500,
    );

    const categoryBalances = context.raw
      .prepare(
        `SELECT c.name, sum(p.amount_minor) AS amount
         FROM postings p
         JOIN ledger_accounts la ON la.id = p.ledger_account_id
         JOIN categories c ON c.id = la.category_id
         GROUP BY c.id`,
      )
      .all() as Array<{ name: string; amount: number }>;
    const balanceByCategory = new Map(
      categoryBalances.map((row) => [row.name, row.amount]),
    );

    expect(balanceByCategory.get("Salary")).toBe(-300000);
    expect(balanceByCategory.get("Debt interest")).toBe(500);
  });

  it("rejects manual activity before either account opening date", async () => {
    const sourceId = await createFinancialAccount({
      name: "New checking",
      type: "checking",
      openingDate: "2026-08-10",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const destinationId = await createFinancialAccount({
      name: "Later savings",
      type: "savings",
      openingDate: "2026-08-15",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const groceriesId = (await listCategories()).find(
      (category) => category.name === "Groceries",
    )!.id;

    await expect(
      createManualTransaction({
        kind: "expense",
        effectiveDate: "2026-08-09",
        description: "Predates source",
        amountMinor: 100,
        financialAccountId: sourceId,
        categoryId: groceriesId,
      }),
    ).rejects.toThrow("opening date");
    await expect(
      createManualTransaction({
        kind: "transfer",
        effectiveDate: "2026-08-12",
        description: "Predates destination",
        amountMinor: 100,
        financialAccountId: sourceId,
        destinationFinancialAccountId: destinationId,
      }),
    ).rejects.toThrow("Later savings");
  });

  it("requires archived accounts and categories to be restored for corrections", async () => {
    const accountId = await createFinancialAccount({
      name: "Closed cash",
      type: "cash",
      openingDate: "2026-08-01",
      openingBalanceMinor: 0,
      requiredForClose: false,
    });
    const categories = await listCategories();
    const salaryId = categories.find((category) => category.name === "Salary")!.id;
    const groceriesId = categories.find(
      (category) => category.name === "Groceries",
    )!.id;

    await createManualTransaction({
      kind: "income",
      effectiveDate: "2026-08-02",
      description: "Temporary income",
      amountMinor: 1000,
      financialAccountId: accountId,
      categoryId: salaryId,
    });
    const expenseId = await createManualTransaction({
      kind: "expense",
      effectiveDate: "2026-08-03",
      description: "Offsetting expense",
      amountMinor: 1000,
      financialAccountId: accountId,
      categoryId: groceriesId,
    });
    await archiveFinancialAccount(accountId);

    await expect(
      reverseJournalEntry({
        journalEntryId: expenseId,
        reason: "Wrong category.",
      }),
    ).rejects.toThrow("Restore Closed cash");

    await restoreFinancialAccount(accountId);
    await reverseJournalEntry({
      journalEntryId: expenseId,
      reason: "Wrong category.",
    });
    await archiveCategory(groceriesId);

    await expect(
      createManualTransaction({
        kind: "expense",
        effectiveDate: "2026-08-04",
        description: "Corrected expense",
        amountMinor: 1000,
        financialAccountId: accountId,
        categoryId: groceriesId,
      }),
    ).rejects.toThrow("active expense category");

    await restoreCategory(groceriesId);
    await createManualTransaction({
      kind: "expense",
      effectiveDate: "2026-08-04",
      description: "Corrected expense",
      amountMinor: 1000,
      financialAccountId: accountId,
      categoryId: groceriesId,
    });

    expect(
      (await listFinancialAccounts()).find((account) => account.id === accountId)
        ?.balanceMinor,
    ).toBe(0);
  });

  it("reverses posted history without mutating or deleting the original", async () => {
    const checkingId = await createFinancialAccount({
      name: "Checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 100000,
      requiredForClose: true,
    });
    const groceries = (await listCategories()).find(
      (category) => category.name === "Groceries",
    )!;
    const entryId = await createManualTransaction({
      kind: "expense",
      effectiveDate: "2026-08-04",
      description: "Groceries",
      amountMinor: 8245,
      financialAccountId: checkingId,
      categoryId: groceries.id,
    });

    await reverseJournalEntry({
      journalEntryId: entryId,
      reason: "Entered from the wrong receipt.",
    });

    const checking = (await listFinancialAccounts()).find(
      (account) => account.id === checkingId,
    );
    const original = context.raw
      .prepare("SELECT description, is_posted FROM journal_entries WHERE id = ?")
      .get(entryId) as { description: string; is_posted: number };
    const reversal = context.raw
      .prepare("SELECT id FROM journal_entries WHERE reverses_entry_id = ?")
      .get(entryId) as { id: number };

    expect(checking?.balanceMinor).toBe(100000);
    expect(original).toEqual({
      description: "Groceries",
      is_posted: 1,
    });
    expect(reversal.id).toBeGreaterThan(entryId);
    expect(() =>
      context.raw
        .prepare("UPDATE journal_entries SET description = 'Changed' WHERE id = ?")
        .run(entryId),
    ).toThrow("immutable");
    await expect(
      reverseJournalEntry({
        journalEntryId: entryId,
        reason: "Second reversal attempt.",
      }),
    ).rejects.toThrow("already been reversed");
  });

  it("requires restoring archived categories before posting corrections", async () => {
    const accountId = await createFinancialAccount({
      name: "Correction cash",
      type: "cash",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10000,
      requiredForClose: false,
    });
    const categoryId = await createCategory({
      name: "Cursos",
      kind: "expense",
    });
    const entryId = await createManualTransaction({
      kind: "expense",
      effectiveDate: "2026-08-03",
      description: "Course",
      amountMinor: 2500,
      financialAccountId: accountId,
      categoryId,
    });

    await archiveCategory(categoryId);

    await expect(
      reverseJournalEntry({
        journalEntryId: entryId,
        reason: "Wrong category.",
      }),
    ).rejects.toThrow("Restore Cursos");

    await expect(
      postJournalEntry({
        effectiveDate: "2026-08-04",
        description: "Direct archived category posting",
        sourceType: "manual",
        postings: [
          {
            ledgerAccountId: ledgerAccountIdForFinancialAccount("Correction cash"),
            amountMinor: -100,
          },
          {
            ledgerAccountId: ledgerAccountIdForCategory("Cursos"),
            amountMinor: 100,
          },
        ],
      }),
    ).rejects.toThrow("archived category");

    await restoreCategory(categoryId);
    await reverseJournalEntry({
      journalEntryId: entryId,
      reason: "Wrong category.",
    });
  });

  it("prevents reversal chains at service and database boundaries", async () => {
    const accountId = await createFinancialAccount({
      name: "Reversal cash",
      type: "cash",
      openingDate: "2026-08-01",
      openingBalanceMinor: 1000,
      requiredForClose: false,
    });
    const groceriesId = (await listCategories()).find(
      (category) => category.name === "Groceries",
    )!.id;
    const originalId = await createManualTransaction({
      kind: "expense",
      effectiveDate: "2026-08-02",
      description: "Original",
      amountMinor: 100,
      financialAccountId: accountId,
      categoryId: groceriesId,
    });
    const reversalId = await reverseJournalEntry({
      journalEntryId: originalId,
      reason: "Correction.",
    });

    await expect(
      reverseJournalEntry({
        journalEntryId: reversalId,
        reason: "Undo correction.",
      }),
    ).rejects.toThrow("cannot be reversed");

    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO journal_entries
             (effective_date, description, source_type, reverses_entry_id)
           VALUES ('2026-08-03', 'Invalid reversal chain', 'system', ?)`,
        )
        .run(reversalId),
    ).toThrow("reversal entries cannot be reversed");
  });

  it("archives categories without changing historical postings", async () => {
    const accountId = await createFinancialAccount({
      name: "Cash",
      type: "cash",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10000,
      requiredForClose: false,
    });
    const categoryId = await createCategory({
      name: "Education",
      kind: "expense",
    });

    await createManualTransaction({
      kind: "expense",
      effectiveDate: "2026-08-03",
      description: "Course",
      amountMinor: 2500,
      financialAccountId: accountId,
      categoryId,
    });
    await archiveCategory(categoryId);

    const category = (await listCategories()).find(
      (candidate) => candidate.id === categoryId,
    );

    expect(category?.archivedAt).not.toBeNull();
    expect(category?.postingCount).toBe(1);
  });

  it("archives only zero-balance accounts and retains their records", async () => {
    const zeroBalanceId = await createFinancialAccount({
      name: "Closed checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 0,
      requiredForClose: false,
    });
    const fundedId = await createFinancialAccount({
      name: "Funded savings",
      type: "savings",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10000,
      requiredForClose: true,
    });

    await expect(archiveFinancialAccount(zeroBalanceId, "2026-07-31")).rejects.toThrow(
      "before its opening date",
    );
    await archiveFinancialAccount(zeroBalanceId, "2026-08-10");
    await expect(archiveFinancialAccount(fundedId)).rejects.toThrow(
      "Bring the account balance to zero",
    );

    const accounts = await listFinancialAccounts();

    expect(
      accounts.find((account) => account.id === zeroBalanceId)?.archivedAt,
    ).not.toBeNull();
    expect(accounts.find((account) => account.id === zeroBalanceId)?.archivedOn).toBe(
      "2026-08-10",
    );
    expect(accounts.find((account) => account.id === fundedId)?.archivedAt).toBeNull();
  });
});
