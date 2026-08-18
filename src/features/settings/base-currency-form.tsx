"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import { type BaseCurrency, supportedCurrencies } from "@/domain/currencies";
import { initialFormActionState } from "@/features/forms/action-state";
import { updateBaseCurrencyAction } from "@/features/settings/actions";

export function BaseCurrencyForm({
  currentCurrency,
}: {
  currentCurrency: BaseCurrency;
}) {
  const [state, action, isPending] = useActionState(
    updateBaseCurrencyAction,
    initialFormActionState,
  );

  return (
    <form action={action} className="settings-currency-form">
      <label className="sr-only" htmlFor="settings-base-currency">
        Reporting currency
      </label>
      <select
        defaultValue={currentCurrency}
        disabled={isPending}
        id="settings-base-currency"
        name="baseCurrency"
      >
        {supportedCurrencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.code} — {currency.name}
          </option>
        ))}
      </select>
      <button className="quiet-button" disabled={isPending} type="submit">
        <Save aria-hidden="true" size={14} />
        {isPending ? "Saving…" : "Save"}
      </button>
      {state.status !== "idle" ? (
        <p
          className={
            state.status === "error"
              ? "settings-currency-form__message settings-currency-form__message--error"
              : "settings-currency-form__message"
          }
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
