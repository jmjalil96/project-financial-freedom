import { Archive, Tags } from "lucide-react";

import { ArchiveCategoryButton } from "@/features/categories/archive-category-button";
import { CategoryForm } from "@/features/categories/category-form";
import type { Category } from "@/features/categories/category-service";
import { RestoreCategoryButton } from "@/features/categories/restore-category-button";

function CategoryGroup({
  title,
  categories,
}: {
  title: string;
  categories: Category[];
}) {
  return (
    <section className="category-group">
      <div className="category-group__heading">
        <h3>{title}</h3>
        <span>{categories.length}</span>
      </div>
      <ul>
        {categories.map((category) => (
          <li key={category.id}>
            <div>
              <strong>{category.name}</strong>
              <span>
                {category.isDefault ? "Default" : "Custom"} · {category.postingCount}{" "}
                {category.postingCount === 1 ? "posting" : "postings"}
              </span>
            </div>
            <ArchiveCategoryButton
              categoryId={category.id}
              categoryName={category.name}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CategoryManager({ categories }: { categories: Category[] }) {
  const active = categories.filter((category) => !category.archivedAt);
  const archived = categories.filter((category) => category.archivedAt);

  return (
    <section className="category-manager">
      <div className="section-heading">
        <div>
          <p className="card-kicker">Flat and explicit</p>
          <h2>Income and expense categories</h2>
          <p>
            Categories are ledger accounts internally. Archiving one preserves every
            historical posting.
          </p>
        </div>
        <span className="section-heading__icon">
          <Tags aria-hidden="true" size={20} />
        </span>
      </div>

      <CategoryForm />

      <div className="category-columns">
        <CategoryGroup
          categories={active.filter((category) => category.kind === "income")}
          title="Income"
        />
        <CategoryGroup
          categories={active.filter((category) => category.kind === "expense")}
          title="Expense"
        />
      </div>

      {archived.length > 0 ? (
        <details className="archived-categories">
          <summary>
            <Archive aria-hidden="true" size={14} />
            Archived categories ({archived.length})
          </summary>
          <ul>
            {archived.map((category) => (
              <li key={category.id}>
                <span>{category.name}</span>
                <div>
                  <small>{category.kind}</small>
                  <RestoreCategoryButton
                    categoryId={category.id}
                    categoryName={category.name}
                  />
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
