import { Check, CircleDashed, Database, HardDrive, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getDatabaseContext } from "@/db/client";
import { getCurrencyName } from "@/domain/currencies";
import { formatMoney, sumMinorUnits } from "@/domain/money";
import { listFinancialAccounts } from "@/features/accounts/account-service";
import { getApplicationSettings } from "@/features/settings/settings-repository";

export const metadata: Metadata = {
  title: "Dashboard",
};

const rhythm = [
  {
    label: "Collect",
    detail: "Prepare your monthly statements",
  },
  {
    label: "Review",
    detail: "Resolve gaps and uncertainty",
  },
  {
    label: "Close",
    detail: "Lock an explainable monthly report",
  },
] as const;

export default async function DashboardPage() {
  const [{ health }, settings, accounts] = await Promise.all([
    getDatabaseContext(),
    getApplicationSettings(),
    listFinancialAccounts(),
  ]);

  if (!settings) {
    return null;
  }

  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const netLedgerPosition = sumMinorUnits(
    activeAccounts.map((account) => account.balanceMinor),
    "The combined account balance exceeds the safe money range.",
  );

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Foundation / Ready</p>
          <h1>Your monthly workspace is ready.</h1>
          <p>
            {activeAccounts.length === 0
              ? "The local database is healthy. Add an account to establish your opening position."
              : `${activeAccounts.length} active ${activeAccounts.length === 1 ? "account is" : "accounts are"} represented by balanced ledger postings.`}
          </p>
        </div>
        <span className="status-badge status-badge--success">
          <Check aria-hidden="true" size={15} />
          Ready
        </span>
      </section>

      <section className="foundation-grid">
        <article className="foundation-card foundation-card--primary">
          <div className="foundation-card__icon">
            <ShieldCheck aria-hidden="true" size={22} />
          </div>
          <p className="card-kicker">Local by design</p>
          <h2>Your financial workspace stays at its configured data location.</h2>
          <p>
            The app listens only on your computer and never sends financial data to a
            hosted backend. You remain responsible for securing any custom folder.
          </p>
        </article>

        <article className="foundation-card">
          <div className="foundation-card__icon">
            <Database aria-hidden="true" size={22} />
          </div>
          <p className="card-kicker">Database</p>
          <h2>Integrity check passed</h2>
          <dl className="compact-facts">
            <div>
              <dt>Status</dt>
              <dd>{health.quickCheck}</dd>
            </div>
            <div>
              <dt>Journal</dt>
              <dd>{health.journalMode.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Migrations</dt>
              <dd>{health.appliedMigrations}</dd>
            </div>
          </dl>
        </article>

        <article className="foundation-card">
          <div className="foundation-card__icon">
            <HardDrive aria-hidden="true" size={22} />
          </div>
          <p className="card-kicker">Reporting currency</p>
          <h2>
            {activeAccounts.length > 0
              ? formatMoney(netLedgerPosition, settings.baseCurrency)
              : settings.baseCurrency}
          </h2>
          <p>
            {activeAccounts.length > 0
              ? `Current ledger position across ${activeAccounts.length} active ${activeAccounts.length === 1 ? "account" : "accounts"}.`
              : `${getCurrencyName(settings.baseCurrency)} will be used across accounts and reports.`}
          </p>
        </article>
      </section>

      <section className="ledger-panel">
        <div className="ledger-panel__heading">
          <div>
            <p className="eyebrow">The monthly rhythm</p>
            <h2>Three deliberate passes, once a month.</h2>
          </div>
          <Link className="text-link" href="/accounts">
            View the next workspace
          </Link>
        </div>

        <ol className="rhythm-cards">
          {rhythm.map((step, index) => (
            <li key={step.label}>
              <span className="rhythm-cards__number">0{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <p>{step.detail}</p>
              </div>
              <CircleDashed
                aria-hidden="true"
                className="rhythm-cards__state"
                size={18}
              />
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
