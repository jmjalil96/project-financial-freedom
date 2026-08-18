export const externalAiCsvPrompt = `Convert the attached [ACCOUNT_TYPE] statement into CSV.

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
Leave category blank for transfers or when uncertain. Do not invent missing dates, amounts, identifiers, descriptions, or transactions. If a required date, amount, or description is absent or unreadable, keep the explicit transaction row, leave that field blank, and explain the problem in notes. The app will block that row; the user must correct the CSV in a text or spreadsheet editor before importing it again. Leave uncertain optional fields blank and briefly explain uncertainty in notes. Return no markdown fences, commentary, summaries, or text outside the CSV.`;
