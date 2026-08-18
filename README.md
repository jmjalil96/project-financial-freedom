# Project Financial Freedom

A local-first application for completing a clear, traceable financial review once a month.

The product goal is documented in [PRODUCT.md](PRODUCT.md), and implementation phases are defined in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Current Status

Phases 1 through 3 provide:

- A local-only Next.js application bound to `127.0.0.1` with a loopback Host allowlist.
- Base-currency onboarding that freezes once financial data exists.
- A generated and migrated SQLite database.
- WAL mode, foreign-key enforcement, preflight integrity checks, and foreign-key checks.
- Verified pre-migration backups.
- A responsive application shell and navigation.
- Isolated database support for tests.
- Asset and liability accounts with balanced opening positions.
- Flat income and expense categories with archiving and explicit restoration.
- Manual expenses, income, refunds, transfers, and evidence-backed balance adjustments.
- Immutable posted journal entries, balanced ledger postings, reversals, and audit events.
- Versioned CSV validation with UTF-8, quoting, date, currency, type, and precision checks.
- Complete in-memory previews with statement-balance warnings and exact-file detection.
- Preview-bound, atomic source-row imports with immutable provenance and paginated history.
- Downloadable CSV resources and a copyable prompt for external AI preparation.

Imported rows remain unresolved source evidence and do not create ledger postings. Transaction review, duplicate decisions, and statement reconciliation begin in Phase 4.

## Run Locally

Requirements:

- Node.js 24 or newer.
- npm.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Run the fast validation suite while developing:

```bash
npm run check:quick
```

Install the Playwright browser once:

```bash
npx playwright install chromium
```

Run the complete validation suite, including the production build and browser
acceptance workflow:

```bash
npm run check
```

Run only the browser acceptance workflow:

```bash
npm run test:e2e
```

## Local Data

Development data defaults to:

```text
~/Library/Application Support/Project Financial Freedom Development/
```

Production data defaults to:

```text
~/Library/Application Support/Project Financial Freedom/
```

Override the directory during development or testing:

```bash
PFF_DATA_DIR=/path/to/private/data npm run dev
```

Or override the database file directly:

```bash
PFF_DATABASE_PATH=/path/to/private/finance.sqlite npm run dev
```

Financial data and backups are stored outside the repository by default. When using an
override, choose a private location and do not place it under version control.
