import { eq, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import { categories, journalEntries, ledgerAccounts, postings } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { createSlug } from "@/domain/slug";
import { recordAuditEvent } from "@/features/audit/audit-service";

export type CategoryKind = "income" | "expense";

export type Category = {
  id: number;
  name: string;
  slug: string;
  kind: CategoryKind;
  isDefault: boolean;
  archivedAt: string | null;
  ledgerAccountId: number;
  postingCount: number;
};

function parseCategoryKind(value: string): CategoryKind {
  if (value !== "income" && value !== "expense") {
    throw new DomainError("Choose income or expense for the category type.");
  }

  return value;
}

export async function createCategory(input: {
  name: string;
  kind: CategoryKind;
}): Promise<number> {
  const { db } = await getDatabaseContext();
  const name = input.name.trim();
  const kind = parseCategoryKind(input.kind);
  const slug = createSlug(name);

  if (!name) {
    throw new DomainError("Enter a category name.");
  }

  if (!slug) {
    throw new DomainError(
      "Enter a category name containing at least one letter or number.",
    );
  }

  return db.transaction((transaction) => {
    const existingCategory = transaction
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slug))
      .get();

    if (existingCategory) {
      throw new DomainError("A category with that name already exists.");
    }

    const categoryResult = transaction
      .insert(categories)
      .values({
        name,
        slug,
        kind,
      })
      .run();
    const categoryId = Number(categoryResult.lastInsertRowid);

    transaction
      .insert(ledgerAccounts)
      .values({
        name,
        kind,
        categoryId,
      })
      .run();

    recordAuditEvent(transaction, {
      action: "category.created",
      entityType: "category",
      entityId: categoryId,
      details: {
        name,
        kind,
        slug,
      },
    });

    return categoryId;
  });
}

export async function listCategories(): Promise<Category[]> {
  const { db } = await getDatabaseContext();
  const rows = db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      kind: categories.kind,
      isDefault: categories.isDefault,
      archivedAt: categories.archivedAt,
      ledgerAccountId: ledgerAccounts.id,
      postingCount: sql<number>`count(case when ${journalEntries.isPosted} = 1 then ${postings.id} end)`,
    })
    .from(categories)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.categoryId, categories.id))
    .leftJoin(postings, eq(postings.ledgerAccountId, ledgerAccounts.id))
    .leftJoin(journalEntries, eq(journalEntries.id, postings.journalEntryId))
    .groupBy(categories.id, ledgerAccounts.id)
    .orderBy(categories.kind, categories.archivedAt, categories.name)
    .all();

  return rows.map((row) => ({
    ...row,
    kind: parseCategoryKind(row.kind),
    postingCount: Number(row.postingCount),
  }));
}

export async function archiveCategory(categoryId: number): Promise<void> {
  const { db } = await getDatabaseContext();

  db.transaction((transaction) => {
    const category = transaction
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId))
      .get();

    if (!category) {
      throw new DomainError("The category does not exist.");
    }

    if (category.archivedAt) {
      return;
    }

    transaction
      .update(categories)
      .set({
        archivedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(categories.id, categoryId))
      .run();

    recordAuditEvent(transaction, {
      action: "category.archived",
      entityType: "category",
      entityId: categoryId,
      details: {
        name: category.name,
        kind: category.kind,
        historicalPostingCount: transaction
          .select({
            count: sql<number>`count(case when ${journalEntries.isPosted} = 1 then ${postings.id} end)`,
          })
          .from(postings)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
          .innerJoin(journalEntries, eq(journalEntries.id, postings.journalEntryId))
          .where(eq(ledgerAccounts.categoryId, categoryId))
          .get()?.count,
      },
    });
  });
}

export async function restoreCategory(categoryId: number): Promise<void> {
  const { db } = await getDatabaseContext();

  db.transaction((transaction) => {
    const category = transaction
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId))
      .get();

    if (!category) {
      throw new DomainError("The category does not exist.");
    }

    if (!category.archivedAt) {
      return;
    }

    transaction
      .update(categories)
      .set({ archivedAt: null })
      .where(eq(categories.id, categoryId))
      .run();

    recordAuditEvent(transaction, {
      action: "category.restored",
      entityType: "category",
      entityId: categoryId,
      details: {
        name: category.name,
        kind: category.kind,
      },
    });
  });
}
