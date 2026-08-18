"use client";

import { ArrowLeftRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getFinancialAccountType } from "@/domain/accounts";
import type { BaseCurrency } from "@/domain/currencies";
import type { ManualTransactionKind } from "@/domain/transactions";
import type { FinancialAccount } from "@/features/accounts/account-service";
import type { Category } from "@/features/categories/category-service";
import { initialFormActionState } from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";
import { createManualTransactionAction } from "@/features/transactions/actions";

type ManualTransactionFormProps = {
  accounts: FinancialAccount[];
  categories: Category[];
  baseCurrency: BaseCurrency;
};

const transactionKinds: Array<{
  value: ManualTransactionKind;
  label: string;
}> = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "refund", label: "Expense refund" },
  { value: "transfer", label: "Transfer" },
  { value: "adjustment", label: "Balance adjustment" },
];

export function ManualTransactionForm({
  accounts,
  categories,
  baseCurrency,
}: ManualTransactionFormProps) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    createManualTransactionAction,
    initialFormActionState,
  );
  const [kind, setKind] = useState<ManualTransactionKind>("expense");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const matchingCategories = categories.filter(
    (category) =>
      !category.archivedAt && category.kind === (kind === "refund" ? "expense" : kind),
  );
  const activeAccounts = accounts.filter((account) => !account.archivedAt);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      className="data-form"
      onReset={() => {
        setKind("expense");
        setSourceAccountId("");
        setCategoryId("");
        setDestinationAccountId("");
      }}
      onSubmit={onSubmit}
      ref={formRef}
    >
      <div className="data-form__heading">
        <div>
          <p className="card-kicker">Balanced by design</p>
          <h2>Record a manual entry</h2>
        </div>
        <ArrowLeftRight aria-hidden="true" size={21} />
      </div>

      {activeAccounts.length === 0 ? (
        <div className="form-blocker">
          Add an active account before recording transactions.
        </div>
      ) : null}

      <div className="kind-switcher" role="group" aria-label="Entry type">
        {transactionKinds.map((transactionKind) => (
          <label key={transactionKind.value}>
            <input
              checked={kind === transactionKind.value}
              name="kind"
              onChange={() => {
                setKind(transactionKind.value);
                setCategoryId("");
                setDestinationAccountId("");
              }}
              type="radio"
              value={transactionKind.value}
            />
            <span>{transactionKind.label}</span>
          </label>
        ))}
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Effective date</span>
          <input name="effectiveDate" required type="date" />
        </label>

        <label className="field">
          <span>Amount</span>
          <div className="money-input">
            <span>{baseCurrency}</span>
            <input inputMode="decimal" name="amount" placeholder="0.00" required />
          </div>
        </label>

        <label className="field form-grid__wide">
          <span>Description</span>
          <input
            maxLength={140}
            name="description"
            placeholder="What happened?"
            required
          />
        </label>

        <label className="field">
          <span>{kind === "transfer" ? "From account" : "Account"}</span>
          <select
            name="financialAccountId"
            onChange={(event) => {
              setSourceAccountId(event.target.value);
              setDestinationAccountId("");
            }}
            required
            value={sourceAccountId}
          >
            <option disabled value="">
              Choose an account
            </option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {getFinancialAccountType(account.type).label}
              </option>
            ))}
          </select>
        </label>

        {kind === "expense" || kind === "income" || kind === "refund" ? (
          <label className="field">
            <span>
              {kind === "income"
                ? "Income"
                : kind === "refund"
                  ? "Original expense"
                  : "Expense"}{" "}
              category
            </span>
            <select
              name="categoryId"
              onChange={(event) => setCategoryId(event.target.value)}
              required
              value={categoryId}
            >
              <option disabled value="">
                Choose a category
              </option>
              {matchingCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {kind === "transfer" ? (
          <label className="field">
            <span>To account</span>
            <select
              name="destinationFinancialAccountId"
              onChange={(event) => setDestinationAccountId(event.target.value)}
              required
              value={destinationAccountId}
            >
              <option disabled value="">
                Choose a destination
              </option>
              {activeAccounts
                .filter((account) => String(account.id) !== sourceAccountId)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {getFinancialAccountType(account.type).label}
                  </option>
                ))}
            </select>
          </label>
        ) : null}

        {kind === "adjustment" ? (
          <label className="field">
            <span>Effect on financial position</span>
            <select defaultValue="increase" name="adjustmentDirection">
              <option value="increase">Increase value / reduce debt</option>
              <option value="decrease">Reduce value / increase debt</option>
            </select>
          </label>
        ) : null}

        <label className="field form-grid__wide">
          <span>
            Notes {kind === "adjustment" ? <em>Required for adjustments</em> : null}
          </span>
          <textarea
            maxLength={500}
            name="notes"
            placeholder={
              kind === "adjustment"
                ? "Explain the evidence for this adjustment."
                : "Optional context"
            }
            required={kind === "adjustment"}
            rows={3}
          />
        </label>
      </div>

      {state.message ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}

      <button
        className="primary-button"
        disabled={isPending || activeAccounts.length === 0}
        type="submit"
      >
        <Plus aria-hidden="true" size={17} />
        {isPending ? "Posting entry…" : "Post balanced entry"}
      </button>
    </form>
  );
}
