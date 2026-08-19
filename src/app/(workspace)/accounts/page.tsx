import { Landmark, WalletCards } from "lucide-react";
import type { Metadata } from "next";

import {
  getFinancialAccountType,
  isLiabilityAccount,
  toNaturalBalance,
} from "@/domain/accounts";
import { formatCalendarDate, getLocalCalendarDate } from "@/domain/calendar-date";
import { formatMoney, sumMinorUnits } from "@/domain/money";
import { AccountForm } from "@/features/accounts/account-form";
import {
  listFinancialAccounts,
  type FinancialAccount,
} from "@/features/accounts/account-service";
import { ArchiveAccountButton } from "@/features/accounts/archive-account-button";
import { RestoreAccountButton } from "@/features/accounts/restore-account-button";
import { getApplicationSettings } from "@/features/settings/settings-repository";

export const metadata: Metadata = {
  title: "Accounts",
};

function AccountCard({
  account,
  archived = false,
  today,
}: {
  account: FinancialAccount;
  archived?: boolean;
  today: string;
}) {
  const type = getFinancialAccountType(account.type);
  const isLiability = isLiabilityAccount(account.type);
  const displayBalance = toNaturalBalance(account.type, account.balanceMinor);

  return (
    <article className="account-card" data-archived={archived}>
      <div className="account-card__heading">
        <span className="account-card__icon">
          {isLiability ? (
            <WalletCards aria-hidden="true" size={19} />
          ) : (
            <Landmark aria-hidden="true" size={19} />
          )}
        </span>
        <div>
          <h3>{account.name}</h3>
          <p>{account.institution || "No institution"}</p>
        </div>
        <span className="type-chip">{type.label}</span>
      </div>

      <div className="account-card__balance">
        <span>{isLiability ? "Amount owed" : "Ledger balance"}</span>
        <strong>{formatMoney(displayBalance, account.currency)}</strong>
      </div>

      <dl className="account-card__facts">
        <div>
          <dt>Tracking since</dt>
          <dd>{formatCalendarDate(account.openingDate)}</dd>
        </div>
        <div>
          <dt>Month close</dt>
          <dd>{account.requiredForClose ? "Required" : "Optional"}</dd>
        </div>
      </dl>

      {!archived ? (
        <ArchiveAccountButton
          accountId={account.id}
          accountName={account.name}
          defaultArchivedOn={today}
          disabled={account.balanceMinor !== 0}
          openingDate={account.openingDate}
        />
      ) : (
        <div className="inline-action">
          <span className="archived-label">Archived</span>
          <RestoreAccountButton accountId={account.id} accountName={account.name} />
        </div>
      )}
    </article>
  );
}

export default async function AccountsPage() {
  const [accounts, settings] = await Promise.all([
    listFinancialAccounts(),
    getApplicationSettings(),
  ]);

  if (!settings) {
    return null;
  }

  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const archivedAccounts = accounts.filter((account) => account.archivedAt);
  const netLedgerPosition = sumMinorUnits(
    activeAccounts.map((account) => account.balanceMinor),
    "The combined account balance exceeds the safe money range.",
  );
  const today = getLocalCalendarDate();

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Financial foundation</p>
          <h1>Accounts</h1>
          <p>
            Track where value is held or owed. Opening positions enter the ledger
            without becoming income or expense.
          </p>
        </div>
        <div className="heading-stat">
          <span>Current ledger position</span>
          <strong>{formatMoney(netLedgerPosition, settings.baseCurrency)}</strong>
          <small>
            {activeAccounts.length} active{" "}
            {activeAccounts.length === 1 ? "account" : "accounts"}
          </small>
        </div>
      </section>

      <section className="accounts-layout">
        <div>
          {activeAccounts.length > 0 ? (
            <div className="account-grid">
              {activeAccounts.map((account) => (
                <AccountCard account={account} key={account.id} today={today} />
              ))}
            </div>
          ) : (
            <div className="compact-empty">
              <Landmark aria-hidden="true" size={24} />
              <h2>No accounts yet</h2>
              <p>Add the first account to establish your opening position.</p>
            </div>
          )}

          {archivedAccounts.length > 0 ? (
            <section className="archived-section">
              <div className="section-heading">
                <div>
                  <p className="card-kicker">Preserved history</p>
                  <h2>Archived accounts</h2>
                </div>
                <span>{archivedAccounts.length}</span>
              </div>
              <div className="account-grid account-grid--archived">
                {archivedAccounts.map((account) => (
                  <AccountCard
                    account={account}
                    archived
                    key={account.id}
                    today={today}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside>
          <AccountForm baseCurrency={settings.baseCurrency} />
        </aside>
      </section>
    </>
  );
}
