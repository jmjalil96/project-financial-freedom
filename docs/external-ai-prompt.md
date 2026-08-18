# External AI Prompt

## Purpose

This prompt helps an external AI model convert a statement into the normalized [CSV Import v1](csv-import-v1.md) format.

The AI is a transcription and suggestion tool only. Project Financial Freedom validates, reviews, reconciles, and stores the financial result.

## Before Using the Prompt

Replace:

- `[ACCOUNT_TYPE]` with `checking`, `savings`, `cash`, `credit_card`, `loan`, `other_asset`, or `other_liability`.
- `[CURRENCY]` with the application's uppercase currency code, such as `USD` or `COP`.
- `[OPTIONAL_CATEGORIES]` with the available category names, or `none provided`.

Review the AI provider's privacy and data-retention settings before uploading a financial statement. Remove account numbers and unrelated personal identifiers when practical.

## Recommended Prompt

```text
Convert the attached [ACCOUNT_TYPE] statement into CSV.

Output only raw CSV with this exact header:
transaction_date,posted_date,description,amount,currency,external_id,merchant,type,category,notes

Extract every posted transaction explicitly shown in the statement, including purchases, deposits, income, withdrawals, payments, transfers, refunds, fees, interest, and explicit adjustments. Do not include pending transactions, balances, totals, due dates, credit limits, rewards, or informational text. Do not create a transaction to make the statement balance.

Use YYYY-MM-DD dates and [CURRENCY] for every row. If only one date is shown, put it in transaction_date and leave posted_date blank. Preserve the original transaction text in description. Use posted_date and external_id only when explicitly shown. Put a cleaned merchant name in merchant only when clear.

Amount means the change to this account's contribution to net worth:
- checking/savings/cash/other_asset: deposits or value increases are positive; purchases, withdrawals, payments, or value decreases are negative
- credit_card: purchases, fees, and interest are negative; payments, refunds, and credits are positive
- loan: interest and added debt are negative; payments reducing the loan are positive
- other_liability: new debt or added charges are negative; payments, forgiveness, or other debt reductions are positive

Allowed nonblank type values are income, expense, transfer, refund, and adjustment. Credit-card and owned-account payments are transfers. Fees and charged interest are expenses. Refunds are not income. Leave type blank when uncertain.

Available categories: [OPTIONAL_CATEGORIES]
Leave category blank for transfers or when uncertain. Do not invent missing dates, amounts, identifiers, descriptions, or transactions. If a required date, amount, or description is absent or unreadable, keep the explicit transaction row, leave that field blank, and explain the problem in notes. The app will block that row; the user must correct the CSV in a text or spreadsheet editor before importing it again. Leave uncertain optional fields blank and briefly explain uncertainty in notes. Return no markdown fences, commentary, summaries, or text outside the CSV.
```

## What to Enter in the App Separately

The CSV does not contain statement metadata. Read these values from the statement and enter them in the upload form:

- Account.
- Statement start date.
- Statement end date.
- Opening balance.
- Closing balance.

For credit cards and loans, enter opening and closing balances as positive amounts owed. Use a negative balance only when the statement shows a credit owed to you. The application converts these values to signed internal balances.

## Quick Verification

Before upload, check that:

- The first line is the exact recommended header.
- The response contains no Markdown code fences or explanation.
- The file contains one account and one statement period.
- Every visible posted transaction appears once.
- No pending transaction appears.
- Opening and closing balances are not transaction rows.
- Credit-card purchases are negative.
- Credit-card payments and refunds are positive.
- Checking expenses and card payments are negative.
- Checking deposits and income are positive.
- Dates use `YYYY-MM-DD`.
- Amounts contain no currency symbols or thousands separators.
- Uncertain information was left blank rather than guessed.

The application remains responsible for catching extraction mistakes through validation, duplicate review, and exact statement reconciliation.
