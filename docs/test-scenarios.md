# Test Scenarios

## Purpose

These synthetic scenarios are the acceptance contract for the version 1 financial rules. They will later become unit, database, CSV, and end-to-end fixtures.

All examples use `USD`, dates in `YYYY-MM-DD`, and decimal amounts for readability. Production code stores the same values in integer minor units.

Related documents:

- [Accounting Rules](accounting-rules.md)
- [CSV Import v1](csv-import-v1.md)
- [Month Close](month-close.md)

## Ledger Notation

Each listed posting uses the internal signed convention:

- Asset increase: positive.
- Asset decrease: negative.
- Liability increase: negative.
- Liability decrease: positive.
- Expense increase: positive.
- Expense reduction: negative.
- Income increase: negative.

The postings for every finalized event must sum to zero.

---

## Scenario 1: Salary

### Source

- Account: checking.
- Transaction date: `2026-08-31`.
- Posted date: `2026-08-31`.
- Description: `PAYROLL ACME INC`.
- Imported amount: `3000.00`.
- Suggested type: `income`.
- Suggested category: `Salary`.

### Expected Decision

- Effective date: `2026-08-31`.
- Confirmed type: income.
- Confirmed category: Salary.

### Expected Ledger

- Checking: `+3000.00`.
- Income: Salary: `-3000.00`.

### Expected Reporting

- August income increases by `3000.00`.
- August expenses do not change.
- This is not a transfer.

---

## Scenario 2: Bank-Account Expense

### Source

- Account: checking.
- Transaction date: `2026-08-04`.
- Posted date: `2026-08-05`.
- Description: `WHOLE FOODS 102`.
- Imported amount: `-82.45`.
- Suggested type: `expense`.
- Suggested category: `Groceries`.

### Expected Decision

- Effective date: `2026-08-05`, using the bank-account posted-date rule.
- Confirmed type: expense.
- Confirmed category: Groceries.

### Expected Ledger

- Checking: `-82.45`.
- Expense: Groceries: `+82.45`.

### Expected Reporting

- August groceries and total expenses increase by `82.45`.
- The source transaction date remains visible even though the posted date is effective.

---

## Scenario 3: Credit-Card Purchase

### Source

- Account: Visa.
- Account type: credit card.
- Transaction date: `2026-08-04`.
- Posted date: `2026-08-05`.
- Description: `WHOLE FOODS 102`.
- Imported amount: `-82.45`.
- Suggested type: `expense`.
- Suggested category: `Groceries`.

### Expected Decision

- Effective date: `2026-08-04`, using the credit-card purchase-date rule.
- Confirmed type: expense.
- Confirmed category: Groceries.

### Expected Ledger

- Visa liability: `-82.45`.
- Expense: Groceries: `+82.45`.

### Expected Reporting

- August groceries and total expenses increase by `82.45`.
- The amount owed on Visa increases by `82.45`.

---

## Scenario 4: Credit-Card Payment

### Checking Source

- Account: checking.
- Transaction date: `2026-08-10`.
- Posted date: `2026-08-10`.
- Description: `ONLINE PAYMENT VISA`.
- Imported amount: `-500.00`.
- Suggested type: `transfer`.

### Card Source

- Account: Visa.
- Transaction date: `2026-08-10`.
- Posted date: `2026-08-10`.
- Description: `PAYMENT RECEIVED`.
- Imported amount: `500.00`.
- Suggested type: `transfer`.

### Expected Decision

- Both effective dates: `2026-08-10`.
- Confirm both rows as transfer legs.
- Match the checking leg to the Visa leg.
- No income or expense category.

### Expected Ledger

Checking-side entry:

- Checking: `-500.00`.
- Transfer clearing: `+500.00`.

Visa-side entry:

- Visa liability: `+500.00`.
- Transfer clearing: `-500.00`.

Combined transfer-clearing balance: `0.00`.

### Expected Reporting

- Income does not change.
- Expenses do not change.
- Checking decreases by `500.00`.
- Amount owed on Visa decreases by `500.00`.
- Net worth does not change.

---

## Scenario 5: Refund

### Source

- Account: Visa.
- Transaction date: `2026-08-12`.
- Posted date: `2026-08-13`.
- Description: `MERCHANT CREDIT WHOLE FOODS`.
- Imported amount: `20.00`.
- Suggested type: `refund`.
- Suggested category: `Groceries`.

### Expected Decision

- Effective date: `2026-08-12`.
- Confirmed type: refund.
- Confirmed category: Groceries.

### Expected Ledger

- Visa liability: `+20.00`.
- Expense: Groceries: `-20.00`.

### Expected Reporting

- August grocery spending decreases by `20.00`.
- August income does not change.
- The amount owed on Visa decreases by `20.00`.

---

## Scenario 6: Split Expense

### Source

- Account: checking.
- Transaction date: `2026-08-18`.
- Posted date: `2026-08-18`.
- Description: `TARGET STORE 1440`.
- Imported amount: `-120.00`.
- Suggested type: `expense`.

### Expected Decision

- Effective date: `2026-08-18`.
- Confirmed type: expense.
- Split `90.00` to Groceries.
- Split `30.00` to Household.

### Expected Ledger

- Checking: `-120.00`.
- Expense: Groceries: `+90.00`.
- Expense: Household: `+30.00`.

### Expected Reporting

- August total expenses increase by `120.00`.
- Groceries increase by `90.00`.
- Household increases by `30.00`.
- The journal entry balances to zero.

---

## Scenario 7: Duplicate Extracted Row

### Source

An external AI result contains the same posted checking transaction twice:

- Transaction and posted date: `2026-08-05`.
- Description: `WHOLE FOODS 102`.
- Amount: `-82.45`.
- External ID: `CHK-1002`.

### Expected Decision

- Effective date for the accepted row: `2026-08-05`.
- Confirmed type: expense.
- Confirmed category: Groceries.
- Accept one row as the economic event.
- Mark the second row as an extraction duplicate.
- Retain both imported rows.
- Record the duplicate decision and link to the accepted event.

### Expected Ledger

Only one journal entry exists:

- Checking: `-82.45`.
- Expense: Groceries: `+82.45`.

### Expected Reconciliation and Reporting

- Accepted account activity includes `-82.45` once.
- August expenses include `82.45` once.
- The duplicate source row remains traceable.
- The application never deletes either source row automatically.

---

## Scenario 8: Transfer Between Owned Accounts

### Checking Source

- Transaction date: `2026-08-20`.
- Posted date: `2026-08-20`.
- Description: `TRANSFER TO SAVINGS`.
- Amount: `-300.00`.
- Type: `transfer`.

### Savings Source

- Transaction date: `2026-08-20`.
- Posted date: `2026-08-21`.
- Description: `TRANSFER FROM CHECKING`.
- Amount: `300.00`.
- Type: `transfer`.

### Expected Decision

- Effective date for checking: `2026-08-20`.
- Effective date for savings: `2026-08-21`.
- Match the two transfer legs despite the one-day posting difference.
- No income or expense category.

### Expected Ledger

Checking-side entry:

- Checking: `-300.00`.
- Transfer clearing: `+300.00`.

Savings-side entry:

- Savings: `+300.00`.
- Transfer clearing: `-300.00`.

### Expected Reporting

- Income does not change.
- Expenses do not change.
- Net worth does not change.
- Transfer clearing returns to zero.

---

## Scenario 9: Statement Closing on the 15th

### Sources

Visa statement A:

- Coverage: `2026-07-16` through `2026-08-15`.

Visa statement B:

- Coverage: `2026-08-16` through `2026-09-15`.
- Includes a `60.00` restaurant purchase made on `2026-08-20` and posted on `2026-08-21`.
- Imported amount: `-60.00`.

### Expected Decision

- Purchase effective date: `2026-08-20`.
- Confirmed type: expense.
- Confirmed category: Dining.

### Expected Ledger

- Visa liability: `-60.00`.
- Expense: Dining: `+60.00`.

### Expected Coverage and Reporting

- Statement A alone does not complete August coverage.
- The union of A and B covers every day of August.
- August remains provisional until statement B is imported, reconciled, reviewed, and finalized.
- After B is finalized, the purchase appears in August dining spending.
- The system calculates readiness from coverage intervals rather than hardcoding September 15.

---

## Scenario 10: Late-Posted Credit-Card Purchase

### Source

- Account: Visa.
- Transaction date: `2026-08-31`.
- Posted date: `2026-09-02`.
- Statement coverage: `2026-08-16` through `2026-09-15`.
- Description: `BOOK STORE`.
- Imported amount: `-45.00`.
- Type: `expense`.
- Category: Books.

### Expected Decision

- Effective date: `2026-08-31`.
- Statement membership remains in the later statement.

### Expected Ledger

- Visa liability: `-45.00`.
- Expense: Books: `+45.00`.

### Expected Closing Behavior

- The purchase contributes to August expenses.
- Under the normal workflow, August waits for the statement covering August 31 and includes the purchase before closing.
- If evidence is imported only after August was previously closed, August must be explicitly reopened.
- The prior close revision remains available.
- August and later affected months become provisional until closed again.

---

## Scenario 11: Opening Balances

### Checking Opening Balance

- Account opening date: `2026-07-31`.
- Amount owned: `2000.00`.

Expected ledger:

- Checking: `+2000.00`.
- Opening equity: `-2000.00`.

### Credit-Card Opening Balance

- Account opening date: `2026-07-31`.
- Amount owed: `500.00`.
- Internal signed balance: `-500.00`.

Expected ledger:

- Visa liability: `-500.00`.
- Opening equity: `+500.00`.

### Expected Decision

- Effective date for both opening balances: `2026-07-31`.
- Classification: opening balance.
- No income or expense category.

### Expected Reporting

- Income does not change.
- Expenses do not change.
- Starting net worth is `1500.00`.
- Both opening balances are traceable to the onboarding decision.

---

## Scenario 12: Loan Principal and Interest

### Starting Position

- Loan amount owed at August 1: `10000.00`.
- Internal signed loan balance: `-10000.00`.

### Loan Statement Activity

Interest charge:

- Transaction and posted date: `2026-08-15`.
- Imported amount on loan account: `-50.00`.
- Type: `expense`.
- Category: Interest.

Payment received:

- Transaction and posted date: `2026-08-20`.
- Imported amount on loan account: `500.00`.
- Type: `transfer`.

Matching checking activity:

- Transaction and posted date: `2026-08-20`.
- Imported amount on checking: `-500.00`.
- Type: `transfer`.

### Expected Decision

- Interest effective date: `2026-08-15`.
- Interest category: Interest.
- Both payment-leg effective dates: `2026-08-20`.
- Match the payment rows as a transfer with no income or expense category.

### Expected Ledger

Interest entry:

- Loan liability: `-50.00`.
- Expense: Interest: `+50.00`.

Checking payment entry:

- Checking: `-500.00`.
- Transfer clearing: `+500.00`.

Loan payment entry:

- Loan liability: `+500.00`.
- Transfer clearing: `-500.00`.

### Expected Reconciliation and Reporting

```text
opening signed loan balance: -10000.00
interest charge:                -50.00
payment:                       +500.00
closing signed loan balance:  -9550.00
```

- Closing amount owed is `9550.00`.
- August interest expense is `50.00`.
- Debt decreases by `450.00` net.
- The `500.00` payment is not an additional expense.
- Transfer clearing returns to zero.

---

## Scenario 13: Uncertain Imported Transaction

### Source

- Account: checking.
- Transaction date: `2026-08-25`.
- Posted date: blank.
- Description: `ACH 839201`.
- Imported amount: `-110.00`.
- Type: blank.
- Category: blank.
- Notes: `Purpose and counterparty unclear`.

### Expected Decision

- Default effective date: `2026-08-25`.
- Type remains unresolved.
- Category remains unresolved.
- The application does not ask AI to invent a classification.

### Expected Ledger and Closing Behavior

- No finalized journal entry is created until the user classifies the row.
- The statement may display a reconciliation calculation using the accepted signed amount.
- The statement cannot be finalized while the row lacks its required decision.
- August cannot close while the transaction remains unresolved.

---

## Scenario 14: Credit-Card Statement Reconciliation

### Statement

- Opening amount owed: `400.00`.
- Internal opening balance: `-400.00`.
- Purchase: `-60.00`.
- Payment: `+200.00`.
- Refund: `+20.00`.
- Closing amount owed: `240.00`.
- Internal closing balance: `-240.00`.

### Expected Calculation

```text
-400.00 - 60.00 + 200.00 + 20.00 = -240.00
```

### Expected Result

- Reconciliation difference is exactly `0.00`.
- The statement may proceed after all row decisions are complete.
- Entering the closing amount owed as `-240.00` in the user interface is rejected or corrected because user-facing liability balances are entered as positive amounts owed.

---

## Cross-Scenario Acceptance Rules

All scenarios must satisfy:

- Imported account amount signs follow [CSV Import v1](csv-import-v1.md).
- Every finalized journal entry balances to zero.
- Income, expense, transfer, refund, and opening-balance behavior matches [Accounting Rules](accounting-rules.md).
- Report months use confirmed effective dates.
- Reconciliation uses statement coverage and accepted signed account amounts.
- Transfers never create income or expense.
- Refunds reduce expenses rather than create income.
- Duplicates never create a second economic event.
- Unknown information remains unresolved.
- Closed reports never change silently.
- Every reported amount traces to its source evidence or manual valuation.
