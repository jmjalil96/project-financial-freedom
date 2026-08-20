"use client";

import {
  ArchiveRestore,
  BadgeCheck,
  DatabaseBackup,
  Download,
  FileJson2,
  HardDriveDownload,
  History,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import type { FormActionState } from "@/features/forms/action-state";
import { initialFormActionState } from "@/features/forms/action-state";
import {
  createManualBackupAction,
  restoreBackupAction,
} from "@/features/recovery/actions";
import type { BackupRestorePreview } from "@/features/recovery/recovery-service";
import type { BackupReason, DatabaseBackupSummary } from "@/server/database-backup";

const reasonLabels: Record<BackupReason, string> = {
  "pre-migration": "Before migration",
  daily: "Daily",
  "pre-reopen": "Before month reopen",
  "pre-correction": "Before correction",
  "pre-restore": "Before restore",
  manual: "Manual snapshot",
};

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatFileSize(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function ActionMessage({ state }: { state: FormActionState }) {
  return state.status === "idle" ? null : (
    <p
      className={`form-message form-message--${state.status}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function ManualBackupForm() {
  const [state, action, isPending] = useActionState(
    createManualBackupAction,
    initialFormActionState,
  );
  return (
    <form action={action} className="data-safety-manual-form">
      <button className="primary-button" disabled={isPending} type="submit">
        <DatabaseBackup aria-hidden="true" size={16} />
        {isPending ? "Verifying snapshot…" : "Create verified backup"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function RestoreForm({ preview }: { preview: BackupRestorePreview }) {
  const [state, action, isPending] = useActionState(
    restoreBackupAction,
    initialFormActionState,
  );
  return (
    <form
      action={action}
      className="restore-confirmation-form"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Restore this snapshot and replace the current live database? A safety backup will be created first.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="filename" type="hidden" value={preview.filename} />
      <label className="checkbox-field">
        <input disabled={isPending} name="acknowledged" type="checkbox" />
        <span>
          I understand that live changes newer than this snapshot will be replaced.
        </span>
      </label>
      <label htmlFor="restore-confirmation">
        Type <strong>RESTORE</strong> to continue
      </label>
      <input
        autoComplete="off"
        disabled={isPending}
        id="restore-confirmation"
        name="confirmation"
      />
      <button className="danger-button" disabled={isPending} type="submit">
        <ArchiveRestore aria-hidden="true" size={15} />
        {isPending ? "Restoring and verifying…" : "Restore this snapshot"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function DataSafetyWorkspace({
  backupDirectory,
  backups,
  preview,
  previewError,
}: {
  backupDirectory: string;
  backups: DatabaseBackupSummary[];
  preview: BackupRestorePreview | null;
  previewError: string | null;
}) {
  return (
    <main className="data-safety-workspace">
      <header className="data-safety-hero">
        <div>
          <p className="eyebrow">Recovery before regret</p>
          <h1>Back up, export, and restore deliberately.</h1>
          <p>
            Every snapshot is created through SQLite&apos;s online backup API and
            checked before it is retained. Restores are staged and rollback-protected.
          </p>
        </div>
        <aside>
          <BadgeCheck aria-hidden="true" size={20} />
          <span>Verified local snapshots</span>
          <strong>{backups.length}</strong>
          <small>Recent copies plus monthly recovery points</small>
        </aside>
      </header>

      <section className="sensitive-data-warning" role="note">
        <ShieldAlert aria-hidden="true" size={20} />
        <p>
          <strong>These downloads contain private financial history.</strong> Keep them
          encrypted or in a private local folder, and never commit them to version
          control or send them through untrusted services.
        </p>
      </section>

      <section className="data-export-grid" aria-label="Financial data exports">
        <article>
          <HardDriveDownload aria-hidden="true" size={22} />
          <p className="card-kicker">Exact recovery</p>
          <h2>SQLite snapshot</h2>
          <p>
            A verified, restorable copy preserving the complete database and audit
            history exactly.
          </p>
          <form action="/settings/exports/sqlite" method="get">
            <button className="primary-button" type="submit">
              <Download aria-hidden="true" size={15} /> Download SQLite
            </button>
          </form>
        </article>
        <article>
          <FileJson2 aria-hidden="true" size={22} />
          <p className="card-kicker">Portable record</p>
          <h2>Versioned JSON</h2>
          <p>
            All financial tables, base-currency metadata, and SHA-256 checksums in an
            inspectable v1 envelope.
          </p>
          <form action="/settings/exports/portable" method="get">
            <button className="secondary-button" type="submit">
              <Download aria-hidden="true" size={15} /> Download JSON
            </button>
          </form>
        </article>
      </section>

      <section className="backup-control-panel">
        <div>
          <p className="card-kicker">On-demand safety point</p>
          <h2>Create a backup before a major change</h2>
          <p>
            Daily, migration, reopen, correction, and restore backups are automatic. Use
            this when you want an additional named-by-time recovery point.
          </p>
        </div>
        <ManualBackupForm />
      </section>

      {previewError ? (
        <section className="restore-preview restore-preview--error" role="alert">
          <ShieldAlert aria-hidden="true" size={21} />
          <p>{previewError}</p>
        </section>
      ) : null}

      {preview ? (
        <section className="restore-preview" id="restore-preview">
          <div className="restore-preview__heading">
            <div>
              <p className="card-kicker">Verified restore preview</p>
              <h2>{formatTimestamp(preview.createdAt)}</h2>
              <code>{preview.filename}</code>
            </div>
            <span>
              <BadgeCheck aria-hidden="true" size={15} /> Integrity checks pass
            </span>
          </div>
          <dl>
            <div>
              <dt>Currency</dt>
              <dd>{preview.baseCurrency ?? "Not configured"}</dd>
            </div>
            <div>
              <dt>Accounts</dt>
              <dd>{preview.counts.accounts}</dd>
            </div>
            <div>
              <dt>Imports</dt>
              <dd>{preview.counts.imports}</dd>
            </div>
            <div>
              <dt>Journal entries</dt>
              <dd>{preview.counts.journalEntries}</dd>
            </div>
            <div>
              <dt>Manual items</dt>
              <dd>{preview.counts.manualItems}</dd>
            </div>
            <div>
              <dt>Close revisions</dt>
              <dd>{preview.counts.closeRevisions}</dd>
            </div>
          </dl>
          <p className="restore-preview__checksum">
            SHA-256 <code>{preview.checksum}</code>
          </p>
          {preview.requiresMigration ? (
            <p className="restore-preview__migration">
              This older snapshot will be backed up and migrated to the current schema
              during restoration.
            </p>
          ) : null}
          <RestoreForm preview={preview} />
        </section>
      ) : null}

      <section className="backup-history-panel">
        <div className="section-heading">
          <div>
            <p className="card-kicker">Recovery history</p>
            <h2>Retained backups</h2>
          </div>
          <History aria-hidden="true" size={19} />
        </div>
        {backups.length > 0 ? (
          <ol className="backup-history-list">
            {backups.map((backup) => (
              <li key={backup.filename}>
                <DatabaseBackup aria-hidden="true" size={17} />
                <div>
                  <strong>{reasonLabels[backup.reason]}</strong>
                  <span>
                    {formatTimestamp(backup.createdAt)} ·{" "}
                    {formatFileSize(backup.sizeBytes)}
                  </span>
                  <code>{backup.filename}</code>
                </div>
                <Link
                  className="quiet-button"
                  href={`/settings/data?restore=${encodeURIComponent(backup.filename)}#restore-preview`}
                >
                  Inspect restore
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className="dashboard-panel-empty">
            The first daily or manual snapshot will appear here.
          </div>
        )}
        <footer>
          <span>Private backup directory</span>
          <code>{backupDirectory}</code>
        </footer>
      </section>
    </main>
  );
}
