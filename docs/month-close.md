# Month Close

## Purpose

Month close turns a provisional calendar month into a trusted, reproducible financial report.

It does not require statements to end on the last day of the month. It requires enough finalized statement coverage to prove that every required account is complete through that day.

Related documents:

- [Accounting Rules](accounting-rules.md)
- [CSV Import v1](csv-import-v1.md)
- [Test Scenarios](test-scenarios.md)

## Calendar Months and Statement Cycles

Reporting months are calendar months. Statement cycles are evidence periods.

- Income, expenses, budgets, and trends use confirmed `effective_date`.
- Account reconciliation uses statement membership, posted information, and signed account activity.
- Coverage uses the statement's explicit inclusive start and end dates.
- Statement closing dates never determine the reporting month of a transaction.

One reporting month may depend on several statement files. One statement may contribute transactions to several reporting months.

## Month States

### Provisional

A month is provisional while any required evidence or decision is incomplete.

Provisional reports may be displayed, but they must identify:

- Accounts whose coverage is incomplete.
- Statements that do not reconcile.
- Uncategorized income or expenses.
- Unresolved duplicate or transfer decisions.
- Manual valuations that are missing or stale.

### Ready to Close

A month is ready when every closing gate passes. Readiness is calculated from evidence and decisions rather than from a hardcoded calendar date.

The final calendar day must also have passed. A current or future calendar month is
never treated as complete merely because its known accounts currently have coverage.

### Closed

A closed month has an immutable close revision containing the evidence and values used to produce its report.

The live close state points to the latest revision. The revision itself is never
updated or deleted.

### Reopened

A closed month becomes reopened only through an explicit user action. Its prior close revision remains available, and a later close creates a new revision.

## Required Accounts

Each active financial account declares whether it is required for month close.

- A required account must have complete, finalized coverage.
- A nonrequired account does not block closing.
- Excluding an account must be an explicit user choice.
- Reports must identify nonrequired accounts whose balances may be stale.
- An account is considered active only between its opening and archival dates.

Accounts without monthly statements, such as cash or rarely updated accounts, should normally be nonrequired or represented as manual items with dated valuations.

## Coverage Rules

Coverage is based on the union of finalized statement intervals for an account.

- Statement start and end dates are inclusive.
- The first and last transaction dates do not establish coverage.
- No activity during part of a statement period still counts as coverage.
- Overlapping intervals do not create duplicate coverage.
- Gaps remain gaps even when a later statement exists.
- The required interval begins after the prior closed month-end and ends on the target month-end.
- During initial onboarding, the account's opening date or first accepted opening balance establishes the beginning of required coverage.

For a target month `M`, every required account must have continuous coverage through the final day of `M`.

## Example: Card Closing on the 15th

Suppose a Visa statement covers July 16 through August 15, and the next statement covers August 16 through September 15.

The two intervals together cover all of August:

```text
July 16 ---------------- August 15
                         August 16 ---------------- September 15
                         |--------- August ---------|
```

August may become ready to close when the second statement is finalized on or after September 15.

An August 20 purchase:

- Appears on the August 16 through September 15 statement.
- Uses August 20 as its effective date when that is the credit-card transaction date.
- Belongs to August spending.
- Prevents August from being complete until the later statement is imported and finalized.

The application calculates this outcome from intervals. It does not assume that every month closes on the 15th.

## Closing Gates

The target month may close only when all of the following are true.

### Sequence

- The previous month is closed, except for the first month established during onboarding.
- No earlier reopened month remains unresolved.

### Account Coverage

- Every required active account has continuous finalized coverage through month-end.
- No unresolved overlap could duplicate financial activity.
- Every statement needed for coverage reconciles exactly.
- Required opening balances are established.

### Transaction Decisions

- Every accepted, nonduplicate row effective on or before the target month-end has a confirmed type.
- Every income, expense, and refund in the target month has a confirmed category.
- Every duplicate candidate affecting the target month has a final decision.
- Every excluded row has a reason.
- Every transfer affecting the target month is matched, marked in transit, or explicitly classified as external.
- Any nonzero transfer-clearing balance is fully explained by transfers explicitly marked in transit.
- Any outside-scope-transfer balance is shown separately and fully explained by transfers to or from owned accounts not tracked in the workspace.
- Every split, refund, fee, interest charge, and adjustment is resolved.
- No unexplained balancing entry exists.

### Manual Items

- Every active manual asset and liability has a valuation applicable to month-end.
- A prior valuation may be carried forward only with explicit acknowledgment.
- Stale carried values remain visibly marked in the report.
- Monthly, quarterly, and annual freshness use calendar-month windows defined in the accounting rules; as-needed values retain a visible age without becoming automatically stale.
- Outside-scope transfers linked to a valued manual item are excluded from the separate transfer balance so the same owned value cannot enter net worth twice.

### Budgets

- Existing budget values are included in the close revision.
- A missing budget does not block closing in version 1.
- The report clearly indicates categories or months without a budget.

## Close Review

Before confirmation, the application presents:

- Target month.
- Readiness status.
- Coverage by account.
- Statements included.
- Reconciliation status.
- Unresolved blockers.
- Income and expense totals.
- Transfer totals excluded from reports.
- Any transfer-clearing balance and its in-transit transactions.
- The outside-scope-transfer balance and its owned-but-untracked source rows.
- Budget status.
- Manual valuation dates and stale-value acknowledgments.
- Provisional net worth.

The user confirms the close only after all blocking items are resolved.

## Close Revision

Closing records an immutable revision with:

- Target calendar month.
- Revision number.
- Close timestamp.
- Included statement imports.
- Included ledger-entry cutoff or manifest.
- Account balances at month-end.
- Manual valuations and carry-forward acknowledgments.
- Budget values.
- Income, expense, savings, debt, and net-worth totals.
- Any nonblocking warnings.
- Reference to the prior revision, if one exists.

The stored revision must allow the application to reproduce what was reported at close time.

Version 1 snapshots record the highest posted journal-entry identifier visible at the
instant of close, or an explicit empty-ledger cutoff. The snapshot JSON stores the
complete report, finalized statement manifest, account coverage proof, and warnings;
the primary revision fields retain the main totals for indexed history views.

## Late Transactions and Corrections

A late transaction may have an effective date in a closed month. It must not silently alter that report.

The workflow is:

1. Identify the earliest closed month affected.
2. Explain which new evidence or correction caused the conflict.
3. Ask the user to reopen that month.
4. Preserve the existing close revision.
5. Mark the affected month and every later closed month as provisional.
6. Apply the reviewed correction or new import.
7. Close the months again in chronological order.

If the new row is a duplicate of already accepted activity, resolving it as a duplicate does not require a financial correction, but the source decision remains traceable.

Because an earlier entry can change later account balances, the lock is based on the
first closed month affected rather than only the entry's own month. The same rule
applies to earlier-dated manual valuations, account or manual-item start and archive
dates, and outside-scope-transfer valuation links. Reopening requires a recorded reason.

Closing resumes chronologically. A later reopened month cannot close while an earlier
reopened month remains unresolved, and an earlier month cannot be inserted underneath
a still-closed later revision.

## Account and Item Lifecycle

### New Account

- Establish an opening date and opening balance.
- Require coverage only from that opening date.
- Do not reinterpret the opening balance as income.

### Archived Account

- Finalize and post every imported statement before archiving the account.
- Require coverage through its final active date.
- Preserve all historical balances and reports.
- Do not require later coverage.

### New Manual Item

- Establish the first valuation date.
- Include it only on or after that date.

### Archived Manual Item

- Preserve prior valuations.
- Exclude it after its final active date unless a disposal transaction or final valuation says otherwise.

## Report Behavior

Closed reports include:

- Income.
- Expenses.
- Savings amount and savings rate.
- Budget planned versus actual.
- Spending by category.
- Debt movement.
- Account balances.
- Net worth and change.
- Missing, excluded, stale, or acknowledged information.

Reports use effective dates. Statement and source drill-downs show where each value came from.

Transfers, opening balances, and manual valuation changes are excluded from income and expense.

## Deliberate Version 1 Limits

Version 1 does not:

- Close months automatically.
- Guess that an account has no missing activity.
- Infer statement coverage from transaction dates.
- Add balancing transactions.
- Reopen or rewrite closed months silently.
- Require a budget in order to close.
- Fetch current balances from institutions.
