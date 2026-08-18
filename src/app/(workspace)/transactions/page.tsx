import { BookOpenCheck, CircleSlash2 } from "lucide-react";
import type { Metadata } from "next";

import { Pagination } from "@/components/pagination";
import { formatCalendarDate } from "@/domain/calendar-date";
import { formatMoney } from "@/domain/money";
import { getPaginationState } from "@/domain/pagination";
import { listFinancialAccounts } from "@/features/accounts/account-service";
import { listCategories } from "@/features/categories/category-service";
import { getApplicationSettings } from "@/features/settings/settings-repository";
import { ManualTransactionForm } from "@/features/transactions/manual-transaction-form";
import {
  countPostedJournalEntries,
  listRecentJournalEntries,
  type JournalEntryListItem,
} from "@/features/transactions/manual-transaction-service";
import { ReversalForm } from "@/features/transactions/reversal-form";

export const metadata: Metadata = {
  title: "Transactions",
};

function EntryCard({
  entry,
  currency,
}: {
  entry: JournalEntryListItem;
  currency: Parameters<typeof formatMoney>[1];
}) {
  const isReversal = entry.reversesEntryId !== null;
  const isReversed = entry.reversedByEntryId !== null;

  return (
    <article className="entry-card" data-reversed={isReversed || isReversal}>
      <div className="entry-card__heading">
        <div>
          <div className="entry-card__meta">
            <span>{formatCalendarDate(entry.effectiveDate)}</span>
            <span>{entry.sourceType.replace("_", " ")}</span>
            {isReversal ? <span>reversal</span> : null}
            {isReversed ? <span>reversed</span> : null}
          </div>
          <h3>{entry.description}</h3>
          {entry.notes ? <p>{entry.notes}</p> : null}
        </div>
        <span className="entry-number">#{entry.id}</span>
      </div>

      <ul className="posting-list">
        {entry.postings.map((posting) => (
          <li key={posting.id}>
            <div>
              <strong>
                {posting.financialAccountName ??
                  posting.categoryName ??
                  posting.ledgerName}
              </strong>
              <span>
                {posting.financialAccountName
                  ? "Financial account"
                  : posting.categoryName
                    ? `${posting.ledgerKind} category`
                    : "System balance"}
              </span>
            </div>
            <code>
              {formatMoney(
                posting.categoryName ? -posting.amountMinor : posting.amountMinor,
                currency,
              )}
            </code>
          </li>
        ))}
      </ul>

      {!isReversal && !isReversed ? <ReversalForm journalEntryId={entry.id} /> : null}
    </article>
  );
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const pageSize = 30;
  const totalEntries = await countPostedJournalEntries();
  const { currentPage, totalPages, offset } = getPaginationState(
    (await searchParams).page,
    totalEntries,
    pageSize,
  );
  const [accounts, categories, entries, settings] = await Promise.all([
    listFinancialAccounts(),
    listCategories(),
    listRecentJournalEntries(pageSize, offset),
    getApplicationSettings(),
  ]);

  if (!settings) {
    return null;
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Balanced ledger</p>
          <h1>Transactions</h1>
          <p>
            Manual entries post only when both sides balance. Posted history is
            corrected through visible reversals, never silent edits.
          </p>
        </div>
        <div className="heading-stat">
          <span>Posted entries</span>
          <strong>{totalEntries}</strong>
          <small>
            Page {currentPage} of {totalPages}
          </small>
        </div>
      </section>

      <section className="transactions-layout">
        <div className="entry-feed">
          <div className="section-heading">
            <div>
              <p className="card-kicker">Traceable history</p>
              <h2>Journal entries</h2>
            </div>
            <span className="section-heading__icon">
              <BookOpenCheck aria-hidden="true" size={20} />
            </span>
          </div>

          {entries.length > 0 ? (
            <div className="entry-list">
              {entries.map((entry) => (
                <EntryCard
                  currency={settings.baseCurrency}
                  entry={entry}
                  key={entry.id}
                />
              ))}
              <Pagination
                currentPage={currentPage}
                newerLabel="Newer entries"
                olderLabel="Older entries"
                pathname="/transactions"
                totalPages={totalPages}
              />
            </div>
          ) : (
            <div className="compact-empty compact-empty--inside">
              <CircleSlash2 aria-hidden="true" size={24} />
              <h2>No posted entries</h2>
              <p>Opening balances and manual transactions will appear here.</p>
            </div>
          )}
        </div>

        <aside>
          <ManualTransactionForm
            accounts={accounts}
            baseCurrency={settings.baseCurrency}
            categories={categories}
          />
        </aside>
      </section>
    </>
  );
}
