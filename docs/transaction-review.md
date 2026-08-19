# Transaction Review

## Purpose

This document is the definitive Phase 4 contract for reviewing imported rows, resolving duplicates, reconciling a statement, and finalizing its review.

Phase 4 turns immutable imported rows into trusted decisions. It does not create journal entries, update ledger balances, pair transfer legs, or post imported activity.

Related documents:

- [Accounting Rules](accounting-rules.md)
- [CSV Import v1](csv-import-v1.md)
- [Test Scenarios](test-scenarios.md)

## Source Evidence

An imported row is immutable source evidence.

- Imported dates, description, amount, currency, external identifier, merchant, type suggestion, category suggestion, notes, batch, filename, checksum, and row number never change.
- A suggestion is untrusted source data. It is not a review decision.
- Merchant normalization, effective-date confirmation, classification, category allocation, notes, exclusion, and duplicate handling are stored as review decisions layered over the source row.
- Editing a review decision never rewrites or deletes the source row.

The imported amount remains the signed change to the selected account's contribution to net worth. Review decisions do not change that amount.

## Row Dispositions

Every imported row begins unresolved, with no disposition. The only disposition values are:

- `accepted`: the row represents account activity included in accepted reconciliation.
- `excluded`: the row is not statement account activity and is omitted from provisional and accepted reconciliation. A nonblank reason is required.
- `duplicate`: the row repeats another imported economic event and is omitted from provisional and accepted reconciliation. It must link to a different source row whose disposition is `accepted`. The later imported row owns the candidate and points back to the earlier canonical row.

An accepted row cannot carry an exclusion reason or duplicate link. An excluded row cannot carry a duplicate link. A duplicate row cannot link to itself or to another excluded, duplicate, or unresolved row.

Excluded and duplicate rows remain visible and traceable to their immutable source evidence.

## Accepted Decisions

An accepted row requires:

- A confirmed effective date on or after the account opening date.
- A confirmed type: `income`, `expense`, `refund`, `transfer`, or `adjustment`.
- A source amount direction consistent with the confirmed type: expenses are negative, while income and refunds are positive.
- Any category allocations required by that type.
- Resolution of warnings that make the date or classification uncertain.

A normalized merchant and explanatory review note are optional. An accepted adjustment is the exception: it requires a nonblank note explaining the supporting evidence.

### Category Allocations

Phase 4 stores category allocation amounts as positive integer minor-unit magnitudes.

- Income uses income categories.
- Expense and refund use expense categories.
- Transfer and adjustment use no income or expense categories.
- Each category may appear at most once on a row.
- Every allocation is greater than zero.
- Allocation magnitudes sum exactly to the absolute imported amount.

One allocation represents a single-category decision. Several allocations represent a split without changing the imported account amount.

The future ledger direction is determined by the confirmed type, not by storing a negative allocation:

- Expense allocations become positive expense postings.
- Income allocations become negative income postings.
- Refund allocations become negative expense postings and therefore reduce spending.

Phase 4 validates these signs and totals but creates none of those postings.

CSV v1 rejects zero-amount rows. A legacy zero-amount row cannot be accepted as income, expense, or refund because positive category allocations cannot represent zero; it must be excluded or reviewed as a supported transfer or documented adjustment.

## Duplicate Detection

Duplicate detection produces review candidates. It never changes a disposition or deletes a row automatically.

Candidate levels are evaluated in this order, and the strongest applicable level is retained for each unordered pair of rows:

1. **Exact file checksum:** a previously committed checksum blocks the entire re-upload before new source rows are created.
2. **Strong row candidate:** rows have the same account and the same nonblank external identifier after trimming surrounding whitespace.
3. **Weak row candidate:** rows have the same account, signed amount, transaction date, and normalized description.
4. **Overlapping-statement review candidate:** rows have the same account, signed amount, and normalized description, and their statement coverage intervals overlap, but no stronger row rule matched.

Description normalization is deterministic: normalize Unicode to NFKC, lowercase with the `en-US` locale, trim the ends, and collapse each run of whitespace or Unicode separators to one ASCII space. Punctuation is retained.

Candidate generation treats a row pair as unordered and records it once. A candidate remains open until the user either:

- Accepts both rows as separate legitimate events and dismisses the candidate.
- Marks one row `duplicate` and links it to the other accepted canonical row.

Legitimate identical purchases remain possible. No candidate level authorizes automatic exclusion, duplicate disposition, mutation, or deletion.

Candidate scans run when an import is committed and immediately before finalization. A migrated batch that predates candidate scanning is scanned once on its first review mutation. Loading the inbox or statement workspace is read-only and never refreshes candidates.

If a finalized batch contains a duplicate decision, its accepted canonical row is locked against exclusion, duplication, or deletion even when the canonical row belongs to another batch. This keeps finalized evidence stable across statement boundaries.

## Review Inbox Semantics

`ready_to_finalize` is row-level readiness: the row is complete and has no open duplicate candidate that it owns. A difference elsewhere in the statement does not turn every complete row into a row blocker. Statement reconciliation differences appear once in the statement reconciliation panel.

`needs_category` includes unresolved rows suggested as income, expense, or refund as well as saved malformed states that have category blockers. `suspected_duplicate` includes any row with an open candidate, including an already accepted row.

## Reconciliation Totals

Reconciliation uses signed internal opening and closing balances and the immutable imported account amounts.

For one statement:

- **Source activity total:** the sum of every imported row amount, regardless of disposition.
- **Provisional activity total:** the sum of rows not explicitly marked `excluded` or `duplicate`. It includes unresolved and accepted rows.
- **Accepted activity total:** the sum of only rows marked `accepted`.

Source and provisional totals are diagnostic and remain traceable to their contributing rows. Final reconciliation uses:

```text
expected closing balance = opening balance + accepted activity total
difference = closing balance - expected closing balance
```

Type, category, merchant, note, and effective-date decisions do not change reconciliation amounts. Once every row has a disposition, provisional activity equals accepted activity.

User-facing liability balances are normalized to signed internal balances before these totals are calculated.

## Review Finalization

Review finalization is blocked unless all of the following are true:

- Opening and closing balances are valid signed internal minor-unit values.
- Every imported row has an `accepted`, `excluded`, or `duplicate` disposition.
- Every accepted row has a valid confirmed effective date and confirmed type.
- Every accepted income, expense, or refund has valid category allocations whose positive magnitudes total exactly the absolute source amount.
- Every accepted expense has a negative source amount, and every accepted income or refund has a positive source amount.
- Every category allocation on an open statement uses an active category. Archiving a category after a statement is finalized does not invalidate the sealed historical allocation.
- Accepted transfers and adjustments have no category allocations.
- Every accepted adjustment has a supporting note.
- Every excluded row has a nonblank reason.
- Every duplicate row links to a different accepted canonical row.
- Every duplicate candidate has been dismissed as legitimate or resolved by a duplicate disposition.
- Every warning that requires an explicit review decision has been resolved.
- The accepted reconciliation difference is exactly zero minor units.

There is no rounding tolerance and no automatic balancing transaction. A difference of even one minor unit blocks finalization.

Finalization atomically locks the statement's review decisions and reconciliation result. Finalized decisions cannot be edited, deleted, or reopened in Phase 4. Later correction work must preserve the finalized evidence and use a future explicit correction workflow rather than mutate the locked decisions.

## Phase Boundary

Confirming `transfer` is a complete Phase 4 type decision. Finding, choosing, or linking the opposite transfer leg is not required for review finalization.

Phase 5 adds the following behavior after the Phase 4 evidence boundary:

- Transfer pairing and in-transit handling.
- Transfer-clearing behavior.
- Creation of journal entries from accepted imported rows.
- Links from journal entries to source rows.
- All other import-to-ledger posting.
- Ledger and account-balance updates caused by imported activity.

The current Phase 5 finalization workflow performs both responsibilities atomically: it
first proves that the Phase 4 evidence is complete and exactly reconciled, then creates
the linked journal entries and seals the statement. Finalized statements created before
Phase 5 retain their locked decisions and expose a one-time posting action.
