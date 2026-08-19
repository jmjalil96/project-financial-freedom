import { ArrowRight, FileClock, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Pagination } from "@/components/pagination";
import { isLiabilityAccount, toNaturalBalance } from "@/domain/accounts";
import { formatCalendarDate } from "@/domain/calendar-date";
import { formatMoney } from "@/domain/money";
import type { ImportHistoryItem } from "@/features/imports/import-service";

const importedAtFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatImportedAt(value: string): string {
  const utcValue = value.includes("T")
    ? value.endsWith("Z")
      ? value
      : `${value}Z`
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(utcValue);

  return Number.isNaN(date.getTime()) ? value : importedAtFormatter.format(date);
}

export function ImportHistory({
  currentPage,
  history,
  totalPages,
}: {
  currentPage: number;
  history: ImportHistoryItem[];
  totalPages: number;
}) {
  return (
    <section className="import-history">
      <div className="section-heading">
        <div>
          <p className="card-kicker">Committed evidence</p>
          <h2>Import history</h2>
          <p>
            Each batch retains its checksum, statement coverage, normalized source rows,
            and original row numbers.
          </p>
        </div>
        <span className="section-heading__icon">
          <FileClock aria-hidden="true" size={20} />
        </span>
      </div>

      {history.length > 0 ? (
        <div className="import-history__list">
          {history.map((item) => {
            const liability = isLiabilityAccount(item.accountType);
            const naturalBalance = (amountMinor: number) =>
              toNaturalBalance(item.accountType, amountMinor);

            return (
              <Link
                className="import-history-card__link"
                href={`/imports/${item.id}/review`}
                key={item.id}
              >
                <article className="import-history-card">
                  <div className="import-history-card__main">
                    <span className="import-history-card__icon">
                      <ShieldCheck aria-hidden="true" size={17} />
                    </span>
                    <div>
                      <div className="import-history-card__meta">
                        <span>Import #{item.id}</span>
                        <span>{item.csvSchemaVersion}</span>
                        <span data-status={item.reviewStatus}>
                          {item.reviewStatus.replace("_", " ")}
                        </span>
                      </div>
                      <h3>{item.sourceFilename}</h3>
                      <p>
                        {item.accountName} ·{" "}
                        {formatCalendarDate(item.statementStartDate)} to{" "}
                        {formatCalendarDate(item.statementEndDate)}
                      </p>
                    </div>
                  </div>

                  <dl>
                    <div>
                      <dt>{liability ? "Opening owed" : "Opening"}</dt>
                      <dd>
                        {formatMoney(
                          naturalBalance(item.openingBalanceMinor),
                          item.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{liability ? "Closing owed" : "Closing"}</dt>
                      <dd>
                        {formatMoney(
                          naturalBalance(item.closingBalanceMinor),
                          item.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Source rows</dt>
                      <dd>{item.rowCount}</dd>
                    </div>
                    <div>
                      <dt>Warnings</dt>
                      <dd>{item.warningCount}</dd>
                    </div>
                  </dl>

                  <div className="import-history-card__trace">
                    <code>{item.fileChecksum}</code>
                    <span>{formatImportedAt(item.importedAt)}</span>
                    <strong className="import-history-card__cta">
                      {item.reviewStatus === "finalized" ? (
                        <LockKeyhole aria-hidden="true" size={12} />
                      ) : (
                        <ArrowRight aria-hidden="true" size={12} />
                      )}
                      {item.reviewStatus === "finalized"
                        ? "View finalized receipt"
                        : "Review statement"}
                    </strong>
                  </div>
                </article>
              </Link>
            );
          })}
          <Pagination
            currentPage={currentPage}
            newerLabel="Newer imports"
            olderLabel="Older imports"
            pathname="/imports"
            totalPages={totalPages}
          />
        </div>
      ) : (
        <div className="compact-empty compact-empty--history">
          <FileClock aria-hidden="true" size={24} />
          <h2>No committed imports</h2>
          <p>A validated CSV appears here only after an explicit commit.</p>
        </div>
      )}
    </section>
  );
}
