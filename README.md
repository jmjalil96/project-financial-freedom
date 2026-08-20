# Project Financial Freedom

A local-first application for completing a clear, traceable financial review once a month.

The product goal is documented in [PRODUCT.md](PRODUCT.md), and implementation phases are defined in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Current Status

Phases 1 through 8 provide:

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
- Immutable review decisions with `accepted`, `excluded`, and `duplicate` dispositions.
- Positive category-allocation magnitudes with exact split and refund rules.
- Deterministic duplicate candidates that never delete source evidence automatically.
- Source, provisional, and accepted reconciliation totals with exact-zero finalization.
- Locked finalized review decisions that cannot be edited or reopened.
- Atomic import-to-ledger posting with one traceable journal entry per accepted row.
- Imported income, expense, refund, split, transfer, and adjustment counterpostings.
- Transfer-clearing visibility, a separate owned-but-untracked balance, explicit
  external and in-transit classifications, and confirmed owned-account or card-payment
  matches.
- Actual-interval statement coverage with overlap merging, exact gaps, irregular
  cycles, account active dates, and optional month-close participation.
- A coverage workspace and imported-ledger links that retain effective, posted, and
  statement dates for their distinct purposes.
- Manual assets and liabilities with active dates, valuation frequencies, immutable
  dated history, explicit carry-forwards, and preserved same-date corrections.
- Reproducible month-end net worth, prior-month change, debt visibility, valuation
  freshness, and component-level source evidence.
- Explicit links from outside-scope transfers to manual valuations that prevent the
  same owned value from being counted twice.
- One nonnegative target per expense category and calendar month, with copy-forward
  that fills only missing targets and never rolls balances over.
- Ledger-exact income, expense, refund-adjusted budget actuals, savings, debt,
  account-balance, and net-worth reports with source drill-downs.
- Actionable close readiness across statement coverage, review decisions, duplicates,
  transfers, valuations, adjustments, and chronological close state.
- Immutable versioned month-close snapshots with preserved evidence, budget targets,
  statement manifests, ledger cutoffs, warnings, and report totals.
- Explicit reopening that preserves prior revisions, invalidates every later close,
  and protects closed results from earlier-dated ledger or valuation changes.
- A decision-focused dashboard that keeps the latest trusted close separate from the
  current provisional month and links every aggregate back to its evidence.
- Deterministic month-over-month facts for spending, budgets, income, debt, net worth,
  first-seen merchants, repeated descriptions, and valuation freshness.
- An exact net-worth bridge that reports cash flow, manual-value movement, and the
  remaining balance-sheet movement without inventing an explanation.

Finalizing a reviewed statement now seals its evidence and posts every accepted row in
the same database transaction. Older Phase 4-only finalized statements can be posted
once through the finalization receipt without reopening their locked decisions.

The functional MVP workflow and its decision layer are complete through Phase 8:
prepare the evidence, close a reproducible month, and use the resulting dashboard to
understand what changed and what requires attention next.

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
