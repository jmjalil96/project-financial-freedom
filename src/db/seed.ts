import { eq } from "drizzle-orm";

import { categories, ledgerAccounts } from "@/db/schema";
import type { AppDatabase } from "@/db/types";

const systemLedgerAccounts = [
  {
    name: "Opening equity",
    kind: "equity",
    systemKey: "opening_equity",
  },
  {
    name: "Transfer clearing",
    kind: "clearing",
    systemKey: "transfer_clearing",
  },
  {
    name: "Outside-scope transfers",
    kind: "clearing",
    systemKey: "outside_scope_transfers",
  },
  {
    name: "Manual adjustments",
    kind: "equity",
    systemKey: "manual_adjustments",
  },
] as const;

const defaultCategories = [
  { name: "Salary", slug: "salary", kind: "income" },
  {
    name: "Interest received",
    slug: "interest-received",
    kind: "income",
  },
  { name: "Other income", slug: "other-income", kind: "income" },
  { name: "Housing", slug: "housing", kind: "expense" },
  { name: "Groceries", slug: "groceries", kind: "expense" },
  { name: "Dining", slug: "dining", kind: "expense" },
  { name: "Transportation", slug: "transportation", kind: "expense" },
  { name: "Utilities", slug: "utilities", kind: "expense" },
  { name: "Health", slug: "health", kind: "expense" },
  { name: "Insurance", slug: "insurance", kind: "expense" },
  { name: "Debt interest", slug: "debt-interest", kind: "expense" },
  { name: "Fees", slug: "fees", kind: "expense" },
  { name: "Shopping", slug: "shopping", kind: "expense" },
  { name: "Entertainment", slug: "entertainment", kind: "expense" },
  { name: "Other expense", slug: "other-expense", kind: "expense" },
] as const;

export function ensureLedgerFoundation(db: AppDatabase): void {
  db.transaction((transaction) => {
    for (const account of systemLedgerAccounts) {
      transaction
        .insert(ledgerAccounts)
        .values(account)
        .onConflictDoNothing({ target: ledgerAccounts.systemKey })
        .run();
    }

    for (const category of defaultCategories) {
      transaction
        .insert(categories)
        .values({
          ...category,
          isDefault: true,
        })
        .onConflictDoNothing({ target: categories.slug })
        .run();

      const storedCategory = transaction
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, category.slug))
        .get();

      if (!storedCategory) {
        throw new Error(`Could not seed category: ${category.name}`);
      }

      transaction
        .insert(ledgerAccounts)
        .values({
          name: category.name,
          kind: category.kind,
          categoryId: storedCategory.id,
        })
        .onConflictDoNothing({ target: ledgerAccounts.categoryId })
        .run();
    }
  });
}
