"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { useActionState } from "react";

import { supportedCurrencies } from "@/domain/currencies";
import {
  completeOnboarding,
  type OnboardingActionState,
} from "@/features/onboarding/actions";

const initialState: OnboardingActionState = {
  error: null,
};

export function OnboardingForm() {
  const [state, action, isPending] = useActionState(completeOnboarding, initialState);

  return (
    <form action={action} className="setup-card">
      <div className="setup-card__heading">
        <span className="step-chip">One-time setup</span>
        <h2>Choose your home currency</h2>
        <p>Every account, budget, and report will use this currency in version one.</p>
      </div>

      <label className="field" htmlFor="baseCurrency">
        <span>Reporting currency</span>
        <select
          aria-describedby={state.error ? "currency-error" : "currency-note"}
          defaultValue=""
          id="baseCurrency"
          name="baseCurrency"
          required
        >
          <option disabled value="">
            Select a currency
          </option>
          {supportedCurrencies.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code} — {currency.name}
            </option>
          ))}
        </select>
      </label>

      {state.error ? (
        <p className="field-error" id="currency-error" role="alert">
          {state.error}
        </p>
      ) : (
        <p className="field-note" id="currency-note">
          You can change this until financial data is added.
        </p>
      )}

      <button className="primary-button" disabled={isPending} type="submit">
        <span>{isPending ? "Creating workspace…" : "Create local workspace"}</span>
        <ArrowRight aria-hidden="true" size={18} />
      </button>

      <div className="privacy-note">
        <LockKeyhole aria-hidden="true" size={16} />
        <span>
          The app never syncs this database. If you configured a custom location, keep
          that folder private and outside version control.
        </span>
      </div>
    </form>
  );
}
