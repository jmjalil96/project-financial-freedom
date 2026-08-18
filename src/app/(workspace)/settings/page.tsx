import { Database, FolderLock, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { getDatabaseContext } from "@/db/client";
import { getCurrencyName } from "@/domain/currencies";
import { CategoryManager } from "@/features/categories/category-manager";
import { listCategories } from "@/features/categories/category-service";
import { BaseCurrencyForm } from "@/features/settings/base-currency-form";
import {
  canChangeBaseCurrency,
  getApplicationSettings,
} from "@/features/settings/settings-repository";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const [context, settings, categories, baseCurrencyCanChange] = await Promise.all([
    getDatabaseContext(),
    getApplicationSettings(),
    listCategories(),
    canChangeBaseCurrency(),
  ]);

  if (!settings) {
    return null;
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Local workspace</p>
          <h1>Settings</h1>
          <p>The small set of decisions that define this private installation.</p>
        </div>
      </section>

      <section className="settings-list">
        <article className="settings-row">
          <div className="settings-row__icon">
            <ShieldCheck aria-hidden="true" size={21} />
          </div>
          <div>
            <h2>Reporting currency</h2>
            <p>
              {baseCurrencyCanChange
                ? "Correct this choice before adding financial data."
                : "Frozen because financial data already exists."}
            </p>
          </div>
          {baseCurrencyCanChange ? (
            <BaseCurrencyForm currentCurrency={settings.baseCurrency} />
          ) : (
            <div className="settings-row__value">
              <strong>{settings.baseCurrency}</strong>
              <span>{getCurrencyName(settings.baseCurrency)}</span>
            </div>
          )}
        </article>

        <article className="settings-row">
          <div className="settings-row__icon">
            <Database aria-hidden="true" size={21} />
          </div>
          <div>
            <h2>Database health</h2>
            <p>Checked automatically whenever the app starts.</p>
          </div>
          <div className="settings-row__value">
            <strong className="healthy-value">Healthy</strong>
            <span>
              WAL · foreign keys on · {context.health.appliedMigrations}{" "}
              {context.health.appliedMigrations === 1 ? "migration" : "migrations"}
            </span>
          </div>
        </article>

        <article className="settings-row settings-row--path">
          <div className="settings-row__icon">
            <FolderLock aria-hidden="true" size={21} />
          </div>
          <div>
            <h2>Local data location</h2>
            <p>The exact configured database file used by this workspace.</p>
          </div>
          <div className="settings-path-value">
            <code>{context.paths.databasePath}</code>
            {context.paths.storageLocation === "configured" ? (
              <p>
                Database and backup files are restricted to your user. Existing custom
                parent folders keep their current permissions, so keep this location
                private, local when possible, and outside version control.
              </p>
            ) : null}
          </div>
        </article>
      </section>

      <CategoryManager categories={categories} />
    </>
  );
}
