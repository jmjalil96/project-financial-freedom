# Recovery and Exports

## Purpose

Project Financial Freedom keeps financial history in one local SQLite database. This
procedure explains how the app creates recovery points, what each export contains, and
how to restore without copying a live WAL database unsafely.

## Backup Locations and Permissions

The default production locations on macOS are:

```text
~/Library/Application Support/Project Financial Freedom/
~/Library/Application Support/Project Financial Freedom/backups/
```

The database and snapshots use owner-only file permissions. The application directory
and default backup directory use owner-only directory permissions. A custom
`PFF_DATA_DIR` or `PFF_DATABASE_PATH` keeps its existing parent-folder permissions, so
that parent must also remain private and outside version control.

The active SQLite `-wal` and `-shm` files are part of the live database state. Do not
copy those files manually. Every application snapshot uses SQLite's online backup API
to produce one consistent `.sqlite` file and then runs `quick_check` and
`foreign_key_check` against the result.

## Automatic Recovery Points

The app creates a verified snapshot:

- before applying migrations;
- once per local calendar day when an existing database first opens;
- before reopening a closed month;
- before posting a reversal or superseding same-date valuation evidence;
- before replacing the live database during restore.

The recovery page also provides an on-demand verified backup button. Retention keeps
the 14 newest snapshots and the newest recovery point from each of the 12 newest
represented months. Identical snapshots created for the same reason are deduplicated by
SHA-256 checksum.

## Downloads

Open **Settings → Backups and exports**.

### SQLite snapshot

The SQLite download is an exact, verified recovery file. Its name begins with
`manual-` and ends with `.sqlite`. Keep the filename unchanged. To make a previously
downloaded snapshot available to the restore interface, quit the app, copy it into the
private backup directory shown on the recovery page, and start the app again.

### Portable JSON

The JSON download is intended for inspection and future data portability. Version 1
contains:

- all 19 application tables, including accounts, categories, imports, decisions,
  ledger entries, postings, budgets, valuations, close revisions, and audit events;
- reporting currency and applied migration count;
- a SHA-256 checksum for every table;
- a SHA-256 checksum over the complete table payload;
- an explicit sensitive-data warning.

The JSON file is not used for exact restoration. Use a SQLite snapshot for that.

Both formats contain private financial history. Store them in an encrypted or private
local location. Never commit them to source control or upload them to an untrusted
service.

## Restore Procedure

1. Open **Settings → Backups and exports**.
2. Find the retained snapshot and select **Inspect restore**.
3. Confirm the timestamp, currency, record counts, migration status, and SHA-256
   checksum.
4. Check the acknowledgment that newer live changes will be replaced.
5. Type `RESTORE` exactly.
6. Choose **Restore this snapshot** and accept the final confirmation.

The app copies the selected snapshot into a private staging file and verifies it before
touching the live database. It then creates a `pre-restore` snapshot of the current
database, closes the active connection, replaces the database, applies any required
migrations, and reruns all startup health checks. The temporary rollback file is removed
only after those checks and the restore audit event succeed.

## If a Restore Fails

A validation failure leaves the live database untouched. If replacement has begun and
the restored database fails to initialize, the app puts the original database back and
reopens it before reporting failure.

Do not delete the selected snapshot or the `pre-restore` snapshot while investigating.
Record the error and preserve the complete private data directory before attempting a
manual recovery. A database created by a newer app version requires upgrading the app;
it is never downgraded automatically.

## Clean-Machine Verification

For a release verification on a clean machine:

1. Install the Node.js version listed in `package.json` and run `npm install`.
2. Run `npm run check` using only the synthetic repository fixtures.
3. Start with a new private `PFF_DATA_DIR` and complete onboarding.
4. Complete the synthetic monthly workflow through close and dashboard review.
5. Download both exports and confirm the SQLite header and JSON checksums.
6. Create a manual backup, add a reversible synthetic change, restore the backup, and
   confirm the change is absent while database health remains green.
7. Confirm the server listens on `127.0.0.1`, telemetry is disabled by the npm scripts,
   and no uploaded CSV file remains in the data directory.
