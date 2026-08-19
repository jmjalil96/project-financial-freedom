# Accounting Rules

## Purpose

These rules define how Project Financial Freedom interprets money. They are the contract for imports, reconciliation, reports, and month closing.

The application is a personal decision tool, not a general-purpose accounting package. It uses a small double-entry ledger internally so that transfers, credit-card payments, refunds, and account balances remain correct. The interface should not require accounting knowledge.

Related documents:

- [CSV Import v1](csv-import-v1.md)
- [Transaction Review](transaction-review.md)
- [Month Close](month-close.md)
- [External AI Prompt](external-ai-prompt.md)
- [Test Scenarios](test-scenarios.md)

## Sources of Truth

The application keeps distinct kinds of information:

- Imported rows are immutable evidence of what a normalized source file contained.
- Review decisions record how the user interpreted an imported row.
- Finalized review decisions are locked evidence. They are not ledger entries.
- Final ledger entries are the source of truth for income, expenses, transfers, and tracked account balances.
- Statement metadata is the source of truth for reconciliation and account coverage.
- Manual valuation records are the source of truth for assets and liabilities that are not ledger accounts.
- Budgets are plans. They never alter the ledger.
- A month-close revision records which evidence and values produced a closed report.

Original statements and uploaded CSV files are not retained. The application retains normalized imported rows, the source filename, a file checksum, the CSV schema version, and the import time.

## Money

- Store money as integer minor units. For a currency with two decimal places, `$12.34` is stored as `1234`.
- Never use binary floating-point values for calculations or persistence.
- Version 1 supports one configurable base currency.
- Every imported row must use the configured base currency.
- Every journal entry must balance exactly in that currency.
- Parsing converts an explicitly valid decimal representation exactly to minor units. Values with excess precision are rejected rather than rounded.
- The base currency cannot change after financial data exists without an explicit reset or future migration.

## Calendar Dates

Financial dates are calendar dates, not instants.

- Store dates as `YYYY-MM-DD`.
- Do not apply timezone conversion to financial dates.
- `transaction_date` is the date on which the purchase or financial event occurred.
- `posted_date` is the date on which the institution finalized the event.
- `effective_date` determines the calendar month used by income, expense, budget, and trend reports.
- Statement start and end dates define reconciliation coverage.
- `imported_at` is an operational timestamp and never affects financial reporting.

### Default Effective-Date Rules

- Credit-card purchase or refund: use `transaction_date`.
- Bank-account income or expense: use `posted_date` when supplied; otherwise use `transaction_date`.
- Credit-card or account transfer: use `posted_date` when supplied; otherwise use `transaction_date`.
- Manual transaction: use the date entered by the user.
- Opening balance: use the account's opening date.
- A user may correct an effective date during review, but the imported dates remain unchanged.
- A confirmed effective date cannot precede the account opening date.
- When the confirmed type changes, recalculate the default from the confirmed type until the user explicitly edits the date.

For an imported credit-card row with no type suggestion, a negative amount is treated
as a charge for default-date purposes and uses `transaction_date`. A positive untyped
row remains ambiguous and follows the transfer-style posted-date default until review.

An event may belong to an earlier reporting month than the statement in which it appears. For example, a credit-card purchase made on August 31 and posted on September 2 belongs to August spending.

## Account Types and Balance Signs

Tracked financial accounts are assets or liabilities.

Asset accounts include:

- Checking.
- Savings.
- Cash.
- Other accounts whose positive balance is owned by the user.

Liability accounts include:

- Credit cards.
- Loans.
- Other accounts whose balance is owed by the user.

Internally:

- Asset balances are positive when value is owned.
- Liability balances are negative when money is owed.
- Transfer clearing is a temporary balance-sheet account and contributes to net worth while a confirmed transfer is in transit.
- Outside-scope transfers use a separate balance-sheet account for value held in owned accounts whose transactions are not tracked in this workspace.
- Net worth is the sum of asset, liability, transfer-clearing, and outside-scope-transfer balances, plus manual asset and liability valuations.

The interface accepts a credit-card or loan balance as an amount owed: positive when the user owes the institution and negative only when the institution shows a credit balance owed to the user. It negates that amount to obtain the internal signed balance used for reconciliation.

## Imported Amount Convention

An imported amount is the change to the selected account's contribution to net worth.

- Positive amounts improve the selected account's financial position.
- Negative amounts reduce the selected account's financial position.

Examples:

- Checking deposit: positive.
- Checking purchase or withdrawal: negative.
- Savings interest received: positive.
- Credit-card purchase, fee, or interest charge: negative.
- Credit-card payment or merchant refund: positive.
- Loan interest charge: negative.
- Loan payment applied to the loan balance: positive.

When a reviewed statement is finalized, the imported amount becomes the posting to the
selected financial account. Counterpostings make the journal entry balance. The Phase 4
review rules remain the evidence gate; Phase 5 creates the entries and source links in
the same finalization transaction.

Accepted expenses must have negative source amounts. Accepted income and refunds must
have positive source amounts. A contradictory type is a review blocker and is also
rejected by the ledger-posting and database boundaries.

## Internal Ledger Convention

The ledger uses signed postings that sum to zero:

- Asset increases are positive; asset decreases are negative.
- Liability increases are negative; liability decreases are positive.
- Expense increases are positive; expense reductions are negative.
- Income increases are negative; income reductions are positive.
- Equity and clearing accounts provide the remaining balanced counterpostings.

Every finalized journal entry must satisfy:

```text
sum(posting amounts) = 0
```

No automatic or unexplained balancing adjustment is permitted.

## Event Classification

### Income

Income is value received from outside the user's tracked financial system.

Examples:

- Salary.
- Interest received.
- Gifts received.
- Business or freelance income.

Moving money from another owned account is not income.

### Expense

An expense is value consumed or paid to an external party.

Examples:

- Groceries.
- Rent.
- Card fees.
- Loan interest.
- Taxes.

Loan principal repayment and credit-card payment are not expenses. Their associated interest or fees are expenses.

### Transfer

A transfer moves value without creating income or expense.

Examples:

- Checking to savings.
- Checking to credit card.
- Checking to an owned investment cash account.
- Movement between two tracked cash accounts.

Phase 4 may confirm that a row is a transfer. In Phase 5, each source-side transfer row
is posted through a transfer-clearing account, so statements remain independently
finalizable. Equal-and-opposite legs in different owned accounts and the same currency
are suggested within a three-calendar-day window, but a match is never stored without
confirmation. Matching opposite legs cancel in clearing. A confirmed in-transit leg may
leave a temporary clearing balance, which remains visible until its matching leg arrives
or the classification is corrected.

An external transfer means a transfer to or from an owned account whose transactions are
not tracked in this workspace. Once explicitly classified, an immutable system entry
moves its balance from transfer clearing to the separate outside-scope-transfer account.
Changing that classification reverses the system entry rather than rewriting it. If
ownership changed, the row is not an external transfer: it must be reviewed as income,
expense, refund, or an evidence-backed adjustment.

### Refund

A refund reduces the original expense category. It is not income.

If the original category is unknown, the refund remains unresolved until reviewed. If the refund covers several categories, it may be split.

### Adjustment

An adjustment is an exceptional correction supported by known evidence. It requires a reason and must not be created automatically to force reconciliation.

- A manual adjustment posts between the affected financial account and the manual-adjustments equity account.
- It changes net worth on its effective date because it changes the supported value of an asset or liability.
- It is excluded from income, expense, and transfer totals. Reports must present it separately as an adjustment to financial position.
- Use it only when evidence establishes the account balance but no better income, expense, transfer, refund, or opening-balance classification exists.
- It does not silently rewrite an earlier entry. A mistake in an adjustment is corrected by reversing it and posting a documented replacement.
- A month containing an unresolved or unexplained adjustment cannot close.

## Categories

- Categories are flat in version 1.
- Categories are either income or expense categories.
- Transfers do not use income or expense categories.
- Uncategorized income or expense blocks month closing.
- Imported category values are suggestions until confirmed.
- Categories may be archived but not deleted when used by historical entries.
- Phase 4 category allocations are positive minor-unit magnitudes that sum exactly to the absolute imported amount.
- Income allocations use income categories. Expense and refund allocations use expense categories.
- A split uses several positive allocations while retaining one immutable imported account amount.
- In Phase 5, expense allocations become positive expense postings, income allocations become negative income postings, and refund allocations become negative expense postings.
- Those posting directions come from the confirmed type; the source sign is validated independently rather than used to infer the category sign.

## Opening Balances

An opening balance establishes the starting financial position without creating income or expense.

- Asset opening balance: positive asset posting and offsetting negative opening-equity posting.
- Liability opening balance: negative liability posting and offsetting positive opening-equity posting.
- Opening balances must identify their effective date.
- Changing a finalized opening balance requires a documented correction rather than direct mutation.

## Statement Reconciliation

Statements use signed internal balances:

```text
closing signed balance = opening signed balance + accepted account activity
```

For an asset account, user-entered balances normally remain positive.

For a credit card or loan, an amount owed is converted to a negative signed balance before applying the equation.

Phase 4 exposes three traceable activity totals:

- Source activity includes every immutable imported row.
- Provisional activity excludes rows explicitly marked `excluded` or `duplicate`, but includes unresolved and accepted rows.
- Accepted activity includes only rows marked `accepted`.

Final reconciliation uses accepted activity. Its difference is the signed closing balance minus the opening signed balance and accepted activity. The difference must equal exactly zero minor units; there is no tolerance or automatic adjustment.

Reconciliation uses statement membership and imported account amounts, not report categories. A statement may reconcile before its review is complete, but review finalization also requires every row disposition and all required exclusion, duplicate, effective-date, type, category, split, refund, and adjustment decisions.

Confirming `transfer` completes the Phase 4 type decision. Phase 5 pairing or unmatched
classification is a separate, auditable resolution and does not block exact statement
reconciliation or review finalization.

The application must never infer statement coverage from the first or last transaction date. Coverage comes from the statement start and end dates entered during import.

## Manual Assets and Liabilities

Property, vehicles, investments tracked only by value, and debts without transaction statements use dated valuations rather than ledger transactions.

- A manual item is either an asset or a liability.
- Asset values are positive.
- Liability values are negative internally, even if the interface displays an amount owed.
- A valuation has an `as_of` date and a source note.
- A stale value may be carried forward only with explicit acknowledgment.
- Valuation changes do not become income or expense automatically.
- The same financial item must not be tracked both as a ledger account and a manual item.
- If a later phase introduces a manual valuation for an account previously represented by the outside-scope-transfer balance, that balance must be explicitly settled or linked so the same owned value is not counted twice.

## Immutability and Corrections

- Imported source fields never change.
- Review decisions may change until their statement is finalized.
- Finalized review decisions cannot be edited, deleted, or reopened in Phase 4.
- Final journal entries are not edited in place.
- A ledger correction reverses or supersedes the prior posted financial interpretation while retaining both versions. It does not mutate a finalized review decision.
- Restore an archived account or category before posting a correction that uses it.
- An account cannot be archived while it has an imported statement that has not posted to the ledger, and an archived account cannot finalize or post a statement.
- A reversal entry is not reversed again. If a correction was wrong, post a documented replacement entry so the full correction chain remains explicit.
- A late event affecting a closed month requires an explicit month reopen and new close revision. This does not reopen finalized statement review decisions.
- Previous close revisions remain reproducible.
- Excluded rows remain visible with their reason.
- Suspected duplicates are never deleted automatically.

## Reporting Rules

- Income and expense reports use `effective_date`.
- Budgets compare confirmed expense postings to the corresponding effective month.
- Transfers and opening balances are excluded from income, expense, and savings calculations.
- Refund postings reduce expense totals in their confirmed category.
- Net worth uses asset, liability, transfer-clearing, and outside-scope-transfer balances plus dated manual valuations.
- A nonzero transfer-clearing balance must be explained by explicit in-transit transfers.
- The outside-scope-transfer balance is shown separately and must trace to explicit owned-but-untracked classifications.
- Provisional months must be labeled as provisional.
- Every aggregate must be traceable to ledger postings or valuation records and then to its source.

## Deliberate Version 1 Limits

Version 1 does not include:

- Multiple currencies or exchange-rate gains.
- Accrual accounting beyond the effective-date rules above.
- Investment tax lots or realized-gain calculations.
- Depreciation.
- Automatic bank synchronization.
- Automatic AI decisions inside the application.
- Automatic balancing entries.
