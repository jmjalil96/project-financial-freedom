"use client";

import {
  Check,
  Clipboard,
  Download,
  FileCheck2,
  FileUp,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";

import {
  getFinancialAccountType,
  isLiabilityAccount,
  toNaturalBalance,
} from "@/domain/accounts";
import type { BaseCurrency } from "@/domain/currencies";
import { formatMoney } from "@/domain/money";
import type { FinancialAccount } from "@/features/accounts/account-service";
import {
  commitCsvImportAction,
  previewCsvImportAction,
} from "@/features/imports/actions";
import type { ImportIssue } from "@/features/imports/csv-contract";
import { externalAiCsvPrompt } from "@/features/imports/external-ai-prompt";
import type {
  ImportPreview,
  ImportValidationResult,
} from "@/features/imports/import-service";

type ImportWorkspaceProps = {
  accounts: FinancialAccount[];
  baseCurrency: BaseCurrency;
  categoryNames: string[];
};

const previewPageSize = 100;

function IssueList({ issues, title }: { issues: ImportIssue[]; title: string }) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <section className="import-issues" role="alert">
      <div>
        <ShieldAlert aria-hidden="true" size={17} />
        <strong>{title}</strong>
      </div>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.rowNumber ?? "file"}-${index}`}>
            {issue.rowNumber ? <span>Row {issue.rowNumber}</span> : null}
            <p>{issue.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatementEquation({ preview }: { preview: ImportPreview }) {
  const liability = isLiabilityAccount(preview.account.type);
  const natural = (amountMinor: number) =>
    toNaturalBalance(preview.account.type, amountMinor);

  return (
    <div className="statement-equation">
      <div>
        <span>Opening {liability ? "owed" : "balance"}</span>
        <strong>
          {formatMoney(
            natural(preview.statement.openingBalanceMinor),
            preview.account.currency,
          )}
        </strong>
      </div>
      <span className="statement-equation__operator">{liability ? "−" : "+"}</span>
      <div>
        <span>CSV activity</span>
        <strong>
          {formatMoney(preview.statement.activityTotalMinor, preview.account.currency)}
        </strong>
      </div>
      <span className="statement-equation__operator">=</span>
      <div>
        <span>Expected close</span>
        <strong>
          {formatMoney(
            natural(preview.statement.expectedClosingBalanceMinor),
            preview.account.currency,
          )}
        </strong>
      </div>
      <div data-mismatch={preview.statement.differenceMinor !== 0}>
        <span>Entered close</span>
        <strong>
          {formatMoney(
            natural(preview.statement.closingBalanceMinor),
            preview.account.currency,
          )}
        </strong>
      </div>
    </div>
  );
}

export function ImportWorkspace({
  accounts,
  baseCurrency,
  categoryNames,
}: ImportWorkspaceProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [errors, setErrors] = useState<
    Extract<ImportValidationResult, { status: "invalid" }>["errors"]
  >([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const selectedAccount = activeAccounts.find(
    (account) => String(account.id) === selectedAccountId,
  );
  const preparedPrompt = externalAiCsvPrompt
    .replace("[ACCOUNT_TYPE]", selectedAccount?.type ?? "[ACCOUNT_TYPE]")
    .replaceAll("[CURRENCY]", baseCurrency)
    .replace(
      "[OPTIONAL_CATEGORIES]",
      categoryNames.length > 0 ? categoryNames.join(", ") : "none provided",
    );
  const previewWarningCount = preview
    ? preview.warnings.length +
      preview.rows.reduce((count, row) => count + row.warnings.length, 0)
    : 0;
  const previewPageCount = preview
    ? Math.max(1, Math.ceil(preview.rows.length / previewPageSize))
    : 1;
  const visiblePreviewRows = preview
    ? preview.rows.slice(
        (previewPage - 1) * previewPageSize,
        previewPage * previewPageSize,
      )
    : [];

  useEffect(() => {
    if (preview) {
      previewRef.current?.focus();
    }
  }, [preview]);

  function sourceFormData(): FormData | null {
    if (!formRef.current || !file) {
      return null;
    }

    const formData = new FormData(formRef.current);
    formData.set("file", file);
    return formData;
  }

  function invalidatePreview() {
    if (preview) {
      setPreview(null);
      setCommitMessage(null);
    }
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = sourceFormData();

    if (!formData) {
      setErrors([
        {
          severity: "error",
          code: "missing_file",
          field: "file",
          message: "Choose a CSV file.",
        },
      ]);
      return;
    }

    setIsPreviewing(true);
    setErrors([]);
    setCommitMessage(null);

    try {
      const result = await previewCsvImportAction(formData);

      if (result.status === "invalid") {
        setPreview(null);
        setErrors(result.errors);
        return;
      }

      setPreviewPage(1);
      setPreview(result.preview);
    } catch {
      setPreview(null);
      setErrors([
        {
          severity: "error",
          code: "preview_request_failed",
          message:
            "The preview request did not complete. Check the connection and file size, then try again.",
        },
      ]);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!preview) {
      return;
    }

    const formData = sourceFormData();

    if (!formData) {
      return;
    }

    setIsCommitting(true);
    setErrors([]);

    try {
      const result = await commitCsvImportAction(formData, preview.approvalToken);

      if (result.status === "invalid") {
        setErrors(result.errors);
        setPreview(null);
        return;
      }

      setCommitMessage(
        `Import #${result.batchId} committed ${result.rowCount} source ${result.rowCount === 1 ? "row" : "rows"} atomically.`,
      );
      setPreview(null);
      setFile(null);
      setSelectedAccountId("");
      formRef.current?.reset();
      router.refresh();
    } catch {
      setErrors([
        {
          severity: "error",
          code: "commit_request_failed",
          message:
            "The commit request did not complete. Validate the source again before retrying.",
        },
      ]);
      setPreview(null);
    } finally {
      setIsCommitting(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setErrors([]);
    setCommitMessage(null);
    setClipboardError(null);
  }

  function cancelImport() {
    setFile(null);
    setPreview(null);
    setErrors([]);
    setCommitMessage(null);
    setSelectedAccountId("");
    setClipboardError(null);
    formRef.current?.reset();
  }

  async function copyPrompt() {
    setClipboardError(null);

    try {
      await navigator.clipboard.writeText(preparedPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
      setClipboardError(
        "The prompt could not be copied. Check browser clipboard permission and try again.",
      );
    }
  }

  return (
    <>
      <section className="import-layout">
        <form
          className="data-form import-form"
          onChange={invalidatePreview}
          onSubmit={handlePreview}
          ref={formRef}
        >
          <div className="data-form__heading">
            <div>
              <p className="card-kicker">Step 1 · Source</p>
              <h2>Prepare an import</h2>
            </div>
            <FileUp aria-hidden="true" size={21} />
          </div>

          {activeAccounts.length === 0 ? (
            <div className="form-blocker">
              Add an active financial account before importing a statement.{" "}
              <Link className="text-link" href="/accounts">
                Open accounts
              </Link>
            </div>
          ) : null}

          <fieldset
            className="import-source-fields"
            disabled={isPreviewing || isCommitting}
          >
            <div className="form-grid">
              <label className="field form-grid__wide">
                <span>Account</span>
                <select
                  name="financialAccountId"
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                  required
                  value={selectedAccountId}
                >
                  <option disabled value="">
                    Choose the statement account
                  </option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {getFinancialAccountType(account.type).label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Statement start</span>
                <input name="statementStartDate" required type="date" />
              </label>

              <label className="field">
                <span>Statement end</span>
                <input name="statementEndDate" required type="date" />
              </label>

              <label className="field">
                <span>
                  Opening{" "}
                  {selectedAccount && isLiabilityAccount(selectedAccount.type)
                    ? "amount owed"
                    : "balance"}
                </span>
                <div className="money-input">
                  <span>{baseCurrency}</span>
                  <input
                    inputMode="decimal"
                    name="openingBalance"
                    placeholder="0.00"
                    required
                  />
                </div>
              </label>

              <label className="field">
                <span>
                  Closing{" "}
                  {selectedAccount && isLiabilityAccount(selectedAccount.type)
                    ? "amount owed"
                    : "balance"}
                </span>
                <div className="money-input">
                  <span>{baseCurrency}</span>
                  <input
                    inputMode="decimal"
                    name="closingBalance"
                    placeholder="0.00"
                    required
                  />
                </div>
              </label>

              <label className="file-field form-grid__wide">
                <input
                  accept=".csv,text/csv"
                  name="file"
                  onChange={handleFileChange}
                  required
                  type="file"
                />
                <span className="file-field__icon">
                  {file ? (
                    <FileCheck2 aria-hidden="true" size={21} />
                  ) : (
                    <FileUp aria-hidden="true" size={21} />
                  )}
                </span>
                <span>
                  <strong>{file?.name ?? "Choose a CSV file"}</strong>
                  <small>
                    {file
                      ? `${(file.size / 1024).toFixed(1)} KB · kept only in memory until commit`
                      : "UTF-8 · maximum 5 MB and 5,000 transaction rows"}
                  </small>
                </span>
              </label>
            </div>
          </fieldset>

          <IssueList issues={errors} title="Import blocked" />

          {commitMessage ? (
            <p className="form-message form-message--success" role="status">
              {commitMessage}
            </p>
          ) : null}

          <div className="form-actions">
            <button
              className="primary-button"
              disabled={isPreviewing || activeAccounts.length === 0}
              type="submit"
            >
              <FileCheck2 aria-hidden="true" size={16} />
              {isPreviewing ? "Validating every row…" : "Validate and preview"}
            </button>
            {(file || preview) && (
              <button className="quiet-button" onClick={cancelImport} type="button">
                <X aria-hidden="true" size={14} />
                Cancel
              </button>
            )}
          </div>
        </form>

        <aside className="import-resources">
          <div className="resource-card">
            <p className="card-kicker">CSV contract · v1</p>
            <h2>Start from a known shape.</h2>
            <p>
              Use the blank template or inspect a synthetic example before preparing
              statement data.
            </p>
            <div>
              <a
                className="quiet-button"
                download
                href="/project-financial-freedom-template.csv"
              >
                <Download aria-hidden="true" size={14} />
                Template
              </a>
              <a
                className="quiet-button"
                download
                href="/project-financial-freedom-example.csv"
              >
                <Download aria-hidden="true" size={14} />
                Example
              </a>
            </div>
          </div>

          <div className="resource-card resource-card--prompt">
            <p className="card-kicker">External AI assistant</p>
            <h2>Prepare, never invent.</h2>
            <p>
              The prompt uses your currency and active categories. Replace the remaining
              account placeholder if no account is selected.
            </p>
            <p className="privacy-warning">
              Remove account numbers and other unnecessary identifiers first. Anything
              sent to an external AI service is subject to that provider&apos;s
              retention and privacy policy.
            </p>
            <button className="quiet-button" onClick={copyPrompt} type="button">
              {copied ? (
                <Check aria-hidden="true" size={14} />
              ) : (
                <Clipboard aria-hidden="true" size={14} />
              )}
              {copied ? "Copied" : "Copy preparation prompt"}
            </button>
            {clipboardError ? (
              <p className="form-message form-message--error" role="alert">
                {clipboardError}
              </p>
            ) : null}
          </div>
        </aside>
      </section>

      {preview ? (
        <section
          aria-labelledby="import-preview-title"
          className="import-preview"
          ref={previewRef}
          tabIndex={-1}
        >
          <div className="import-preview__heading">
            <div>
              <p className="card-kicker">Step 2 · Complete preview</p>
              <h2 id="import-preview-title">{preview.sourceFilename}</h2>
              <p>
                {preview.rows.length} normalized{" "}
                {preview.rows.length === 1 ? "row" : "rows"} for {preview.account.name}{" "}
                · checksum <code>{preview.checksum.slice(0, 12)}</code>
              </p>
            </div>
            <span
              className={
                previewWarningCount > 0
                  ? "status-badge status-badge--warning"
                  : "status-badge status-badge--success"
              }
            >
              {previewWarningCount > 0
                ? `${previewWarningCount} ${previewWarningCount === 1 ? "warning" : "warnings"}`
                : "Validated"}
            </span>
          </div>

          <StatementEquation preview={preview} />

          {preview.warnings.length > 0 ? (
            <section className="preview-warnings">
              <h3>Warnings remain unresolved</h3>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.rowNumber ?? "batch"}-${index}`}>
                    {warning.rowNumber ? (
                      <span>Row {warning.rowNumber}</span>
                    ) : (
                      <span>Statement</span>
                    )}
                    {warning.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Transaction</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Suggestions</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visiblePreviewRows.map((row) => (
                  <tr key={row.originalRowNumber}>
                    <td>
                      <code>{row.originalRowNumber}</code>
                    </td>
                    <td>
                      <strong>{row.transactionDate}</strong>
                      <span>Posted: {row.postedDate ?? "Not provided"}</span>
                      <span>Effective: {row.defaultEffectiveDate}</span>
                    </td>
                    <td>
                      <strong>{row.description}</strong>
                      <span>Merchant: {row.merchant ?? "Not provided"}</span>
                      <span>External ID: {row.externalId ?? "Not provided"}</span>
                      <span>Notes: {row.notes ?? "Not provided"}</span>
                    </td>
                    <td>
                      <strong>
                        {formatMoney(row.amountMinor, preview.account.currency)}
                      </strong>
                      <span>{row.currency}</span>
                    </td>
                    <td>
                      <strong>{row.suggestedType ?? "Unresolved type"}</strong>
                      <span>{row.suggestedCategory ?? "Unresolved category"}</span>
                    </td>
                    <td>
                      <span
                        className={
                          row.warnings.length > 0
                            ? "row-status row-status--warning"
                            : "row-status row-status--valid"
                        }
                      >
                        {row.warnings.length > 0
                          ? `${row.warnings.length} ${row.warnings.length === 1 ? "warning" : "warnings"}`
                          : "Valid"}
                      </span>
                      {row.warnings.map((warning, index) => (
                        <span
                          key={`${warning.code}-${warning.field ?? "row"}-${index}`}
                        >
                          {warning.message}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewPageCount > 1 ? (
            <nav aria-label="Import preview pages" className="pagination">
              <button
                className="quiet-button"
                disabled={previewPage === 1}
                onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                Previous rows
              </button>
              <span>
                Rows {(previewPage - 1) * previewPageSize + 1}–
                {Math.min(previewPage * previewPageSize, preview.rows.length)} of{" "}
                {preview.rows.length}
              </span>
              <button
                className="quiet-button"
                disabled={previewPage === previewPageCount}
                onClick={() =>
                  setPreviewPage((page) => Math.min(previewPageCount, page + 1))
                }
                type="button"
              >
                Next rows
              </button>
            </nav>
          ) : null}

          <div className="preview-actions">
            <div>
              <strong>Commit all rows or none</strong>
              <span>The original file bytes are discarded after this request.</span>
            </div>
            <button
              className="quiet-button"
              onClick={() => setPreview(null)}
              type="button"
            >
              Back to metadata
            </button>
            <button
              className="primary-button"
              disabled={isCommitting}
              onClick={handleCommit}
              type="button"
            >
              <FileCheck2 aria-hidden="true" size={16} />
              {isCommitting ? "Committing atomically…" : "Commit import"}
            </button>
          </div>
        </section>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {preview
          ? `Preview ready with ${preview.rows.length} rows and ${previewWarningCount} warnings.`
          : (commitMessage ?? "")}
      </p>
    </>
  );
}
