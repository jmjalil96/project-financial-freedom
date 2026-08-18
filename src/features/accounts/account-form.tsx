"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  financialAccountTypes,
  isLiabilityAccount,
  type FinancialAccountType,
} from "@/domain/accounts";
import type { BaseCurrency } from "@/domain/currencies";
import { createAccountAction } from "@/features/accounts/actions";
import { initialFormActionState } from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";

type AccountFormProps = {
  baseCurrency: BaseCurrency;
};

export function AccountForm({ baseCurrency }: AccountFormProps) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    createAccountAction,
    initialFormActionState,
  );
  const [accountType, setAccountType] = useState<FinancialAccountType>("checking");
  const formRef = useRef<HTMLFormElement>(null);
  const isLiability = isLiabilityAccount(accountType);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <form
      className="data-form"
      onReset={() => setAccountType("checking")}
      onSubmit={onSubmit}
      ref={formRef}
    >
      <div className="data-form__heading">
        <div>
          <p className="card-kicker">New tracked account</p>
          <h2>Add an account</h2>
        </div>
        <span className="currency-chip currency-chip--light">{baseCurrency}</span>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Account name</span>
          <input
            autoComplete="off"
            maxLength={80}
            name="name"
            placeholder="Everyday checking"
            required
          />
        </label>

        <label className="field">
          <span>Institution</span>
          <input
            autoComplete="organization"
            maxLength={80}
            name="institution"
            placeholder="Optional"
          />
        </label>

        <label className="field">
          <span>Account type</span>
          <select
            name="type"
            onChange={(event) =>
              setAccountType(event.target.value as FinancialAccountType)
            }
            value={accountType}
          >
            {financialAccountTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Opening date</span>
          <input name="openingDate" required type="date" />
        </label>

        <label className="field form-grid__wide">
          <span>{isLiability ? "Opening amount owed" : "Opening balance"}</span>
          <div className="money-input">
            <span>{baseCurrency}</span>
            <input
              defaultValue="0"
              inputMode="decimal"
              name="openingBalance"
              required
            />
          </div>
          <small>
            {isLiability
              ? "Enter debt as positive. Use a negative value only for a credit owed to you."
              : "Use the balance on the date tracking begins."}
          </small>
        </label>
      </div>

      <label className="check-field">
        <input defaultChecked name="requiredForClose" type="checkbox" />
        <span>
          <strong>Require this account for month close</strong>
          <small>Missing statement coverage will block a future close.</small>
        </span>
      </label>

      {state.message ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}

      <button className="primary-button" disabled={isPending} type="submit">
        <Plus aria-hidden="true" size={17} />
        {isPending ? "Adding account…" : "Add account"}
      </button>
    </form>
  );
}
