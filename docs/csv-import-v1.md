# CSV Import v1

## Purpose

This document is the complete version 1 contract for transaction files accepted by Project Financial Freedom.

The file may be prepared manually or by an external AI model. The application treats its contents as untrusted input: it validates, previews, reviews, and reconciles every import before creating ledger entries.

Related documents:

- [Accounting Rules](accounting-rules.md)
- [External AI Prompt](external-ai-prompt.md)
- [Month Close](month-close.md)
- [Test Scenarios](test-scenarios.md)

## One File, One Account, One Statement

Each CSV must represent:

- One tracked financial account.
- One statement or explicit account-coverage period.
- One currency.
- Posted statement activity only.

Do not combine several accounts or statement periods in one file.

The CSV contains transaction rows only. Statement-level information is entered separately in the upload form:

- Account.
- Statement start date.
- Statement end date.
- Opening balance.
- Closing balance.
- Source filename.

## File Format

- Encoding: UTF-8, with or without a UTF-8 BOM.
- Delimiter: comma.
- Record separator: LF or CRLF.
- Header row: required.
- Column names: lowercase and case-sensitive.
- Dates: `YYYY-MM-DD`.
- Decimal separator: period.
- Quoting: standard CSV double-quote rules.
- Blank optional fields: empty value between delimiters.
- Unknown columns: rejected in version 1.
- Repeated header names: rejected.
- Empty transaction rows: ignored only when every field is empty.
- Maximum file size: 5 MB.
- Maximum transaction rows: 5,000.
- Maximum characters in one CSV record, including quoted line breaks: 100,000.

Fields containing commas, quotes, or line breaks must be quoted according to standard CSV rules.

## Columns

### Required

#### `transaction_date`

The date shown for the purchase or financial event.

- Format: `YYYY-MM-DD`.
- Do not invent a missing date.
- If the statement shows only one date, place it here and leave `posted_date` blank.
- A blank or invalid value blocks import.

#### `description`

The transaction description as shown by the source.

- Preserve the source wording.
- Do not replace it with a normalized merchant name.
- Do not add explanations to this field.
- Use `merchant` and `notes` for interpreted values.
- A blank value blocks import.

#### `amount`

The signed change to the selected account's contribution to net worth.

- Use a plain decimal number.
- Do not include a currency symbol.
- Do not include thousands separators.
- Do not use parentheses for negatives.
- Use no more fractional digits than the currency supports.
- The amount must not be zero. Rows with no financial activity are not transaction evidence and must be omitted from the CSV.

Examples:

```text
2500.00
-82.45
40.00
```

Sign rules:

- Checking or savings deposit: positive.
- Checking or savings purchase, withdrawal, or payment: negative.
- Cash or other-asset increase: positive.
- Cash or other-asset decrease: negative.
- Credit-card purchase, fee, or interest charge: negative.
- Credit-card payment, merchant refund, or statement credit: positive.
- Loan interest charge: negative.
- Loan payment applied to the loan account: positive.
- Other-liability debt increase: negative.
- Other-liability payment, forgiveness, or reduction: positive.

A blank, zero, nonnumeric, or excessively precise value blocks import.

#### `currency`

The uppercase ISO 4217 currency code, such as `USD`, `EUR`, or `COP`.

- It must match the application's configured base currency.
- Do not use currency symbols.
- A blank, invalid, or mismatched value blocks import.

### Optional

#### `posted_date`

The date on which the institution finalized the transaction.

- Format: `YYYY-MM-DD`.
- Leave blank unless the source explicitly provides it.
- Do not copy `transaction_date` into this column merely to fill it.
- An invalid nonblank value blocks import.

#### `external_id`

A transaction identifier explicitly provided by the institution or source export.

- Leave blank if no identifier is present.
- Never invent an identifier.
- It is evidence for duplicate detection, not an automatic deletion instruction.

#### `merchant`

A cleaned, human-readable merchant or counterparty name.

- This may normalize an unclear source description.
- Leave blank when uncertain.
- The original wording must remain in `description`.

#### `type`

An optional classification suggestion.

Allowed nonblank values:

- `income`
- `expense`
- `transfer`
- `refund`
- `adjustment`

Rules:

- Use `transfer` for credit-card payments and movement between owned accounts.
- Use `refund` for money returned from a prior expense.
- Fees and charged interest are `expense`.
- Use `adjustment` only when the source explicitly identifies an adjustment.
- Leave blank when uncertain.
- Any other nonblank value blocks import.

The application requires review before accepting the suggestion.

#### `category`

An optional income or expense category suggestion.

- Leave blank for transfers.
- For a refund, suggest the original expense category when known.
- Do not invent a category when uncertain.
- The application may leave an unrecognized category unresolved.
- A category suggestion never creates a category automatically.

#### `notes`

An optional explanation of uncertainty or source context.

Examples:

- `Date was present but merchant was unclear`
- `Possible transfer to savings`
- `Category uncertain`

Notes are not financial evidence and do not override the other fields.

## Minimal Valid Header

```csv
transaction_date,description,amount,currency
```

## Recommended Header

External preparation tools should use the full header:

```csv
transaction_date,posted_date,description,amount,currency,external_id,merchant,type,category,notes
```

Columns may appear in any order, but only the documented names are accepted.

## Checking-Account Example

```csv
transaction_date,posted_date,description,amount,currency,external_id,merchant,type,category,notes
2026-08-01,2026-08-01,PAYROLL ACME INC,3000.00,USD,CHK-1001,Acme Inc,income,Salary,
2026-08-04,2026-08-05,WHOLE FOODS 102,-82.45,USD,CHK-1002,Whole Foods,expense,Groceries,
2026-08-10,2026-08-10,ONLINE PAYMENT VISA,-500.00,USD,CHK-1003,Visa,transfer,,
```

## Credit-Card Example

```csv
transaction_date,posted_date,description,amount,currency,external_id,merchant,type,category,notes
2026-08-04,2026-08-05,WHOLE FOODS 102,-82.45,USD,CC-2001,Whole Foods,expense,Groceries,
2026-08-10,2026-08-10,PAYMENT RECEIVED,500.00,USD,CC-2002,,transfer,,
2026-08-12,2026-08-13,MERCHANT CREDIT,20.00,USD,CC-2003,Whole Foods,refund,Groceries,
2026-08-15,2026-08-15,INTEREST CHARGE,-12.35,USD,CC-2004,,expense,Interest,
```

## Included and Excluded Rows

Include every posted activity row that affects the statement account, including:

- Purchases.
- Deposits.
- Income.
- Withdrawals.
- Account transfers.
- Credit-card and loan payments.
- Refunds and credits.
- Fees.
- Charged or received interest.
- Explicit institution adjustments.

Do not include:

- Pending activity.
- Opening or closing balances.
- Statement totals and subtotals.
- Credit limits.
- Available-credit figures.
- Minimum-payment or amount-due summaries.
- Due dates.
- Rewards balances.
- Advertisements or informational text.
- Transactions not explicitly present in the source.

Statement metadata belongs in the upload form, not as CSV rows.

## Effective Date

Version 1 does not accept an `effective_date` column.

The application derives a default from the account type and imported dates:

- Credit-card purchase or refund: `transaction_date`.
- Other imported activity: `posted_date` when present, otherwise `transaction_date`.

When a credit-card row leaves `type` blank, a negative amount is treated as a charge
for this default-date decision and uses `transaction_date`. A positive untyped row is
ambiguous between a payment and refund, so it uses the other-activity rule until review.

The user confirms or corrects the effective date during review. Reports use the confirmed effective date. Reconciliation continues to use statement membership and the imported account amount.

## Import Validation

Blocking errors include:

- Missing or repeated headers.
- Unknown columns.
- Missing required values.
- Invalid dates.
- Invalid amount syntax.
- Excess amount precision.
- Invalid or mismatched currency.
- Unsupported nonblank type.
- A file with no transaction rows.

Warnings requiring review may include:

- A transaction date outside the statement period.
- A posted date outside the statement period.
- A posted date earlier than its transaction date.
- Repeated external identifiers.
- Exact or similar rows from previous imports.
- Category names not found in the application.
- A transfer with no apparent matching leg.
- Description or notes that indicate uncertainty.

A warning does not change the source row automatically.

## Statement Balances and Reconciliation

Balances are entered in the natural form shown to the user:

- Checking and savings balances are amounts owned.
- Credit-card and loan balances are positive amounts owed.
- A negative credit-card or loan balance is used only when the institution shows a credit balance owed to the user.

The application negates credit-card and loan balances to obtain their internal signed balances.

Reconciliation then uses:

```text
closing signed balance = opening signed balance + accepted CSV amounts
```

Example for a credit card:

```text
opening amount owed:          400.00  -> internal -400.00
purchase:                     -60.00
payment:                     +200.00
refund:                       +20.00
expected closing amount owed: 240.00  -> internal -240.00
```

An import cannot be finalized until the equation balances exactly. The application never adds a synthetic adjustment to hide a difference.

## Duplicate and Correction Policy

- The application computes a checksum before discarding the uploaded file bytes.
- Re-uploading the exact same file is blocked.
- Changed formatting or a regenerated AI result may produce a different checksum, so row-level duplicate review is still required.
- Suspected duplicates remain visible until the user decides.
- Excluding a duplicate retains its source row and exclusion reason.
- Imported values never change after commitment.
- Review decisions may be corrected until statement finalization.
- Corrections after finalization follow the reversal or supersession rules in [Accounting Rules](accounting-rules.md).

## Versioning

The application records `csv-v1` with each import.

Any change that alters required columns, amount meaning, date meaning, accepted type values, or validation behavior requires a new documented schema version. Existing imports continue to use the rules of the version recorded with them.
