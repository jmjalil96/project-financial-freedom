"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Copy,
  LockKeyhole,
  PiggyBank,
  ReceiptText,
  Save,
} from "lucide-react";
import Link from "next/link";

import { formatMoney, minorUnitsToDecimalInput } from "@/domain/money";
import {
  copyPreviousMonthBudgetsAction,
  setMonthlyBudgetAction,
} from "@/features/budgets/actions";
import type {
  BudgetCategoryView,
  BudgetMonthView,
} from "@/features/budgets/budget-service";
import {
  initialFormActionState,
  type FormActionState,
} from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";

function ActionMessage({ state }: { state: FormActionState }) {
  return state.status === "idle" ? null : (
    <p
      className={"form-message form-message--" + state.status}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function BudgetTargetForm({
  category,
  budget,
}: {
  category: BudgetCategoryView;
  budget: BudgetMonthView;
}) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    setMonthlyBudgetAction,
    initialFormActionState,
  );
  return (
    <form className="budget-target-form" onSubmit={onSubmit}>
      <input name="targetMonth" type="hidden" value={budget.targetMonth} />
      <input name="categoryId" type="hidden" value={category.categoryId} />
      <label>
        <span>Monthly target</span>
        <div className="money-input">
          <span>{budget.currency}</span>
          <input
            aria-label={category.categoryName + " monthly target"}
            defaultValue={
              category.plannedMinor === null
                ? ""
                : minorUnitsToDecimalInput(category.plannedMinor, budget.currency)
            }
            disabled={!budget.isEditable || category.categoryArchivedAt !== null}
            inputMode="decimal"
            min="0"
            name="amount"
            placeholder="Not set"
            required
          />
        </div>
      </label>
      {budget.isEditable && category.categoryArchivedAt === null ? (
        <button
          aria-label={"Save " + category.categoryName + " target"}
          className="quiet-button"
          disabled={isPending}
          type="submit"
        >
          <Save aria-hidden="true" size={14} />
          {isPending ? "Saving…" : "Save"}
        </button>
      ) : null}
      <ActionMessage state={state} />
    </form>
  );
}

function CopyBudgetForm({ budget }: { budget: BudgetMonthView }) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    copyPreviousMonthBudgetsAction,
    initialFormActionState,
  );
  return (
    <form className="budget-copy-form" onSubmit={onSubmit}>
      <input name="targetMonth" type="hidden" value={budget.targetMonth} />
      <button className="secondary-button" disabled={isPending} type="submit">
        <Copy aria-hidden="true" size={15} />
        {isPending ? "Copying…" : "Copy previous month"}
      </button>
      <small>Only missing targets are copied; existing choices stay intact.</small>
      <ActionMessage state={state} />
    </form>
  );
}

export function BudgetWorkspace({ budget }: { budget: BudgetMonthView }) {
  const remainingPositive = budget.remainingTotalMinor >= 0;
  return (
    <main className="budget-workspace">
      <header className="budget-hero">
        <div>
          <p className="eyebrow">Simple monthly targets</p>
          <h1>Budget for {budget.targetMonth}</h1>
          <p>
            Plan expense categories independently each month. Refunds reduce actual
            spending; transfers and opening balances never consume a target.
          </p>
        </div>
        <form action="/budgets" className="coverage-month-form" method="get">
          <label htmlFor="budget-month">Target month</label>
          <input
            defaultValue={budget.targetMonth}
            id="budget-month"
            name="month"
            type="month"
          />
          <button className="primary-button" type="submit">
            View budget
          </button>
        </form>
      </header>

      <section className="budget-summary" aria-label="Budget summary">
        <article>
          <PiggyBank aria-hidden="true" size={18} />
          <span>Planned</span>
          <strong>{formatMoney(budget.plannedTotalMinor, budget.currency)}</strong>
        </article>
        <article>
          <ReceiptText aria-hidden="true" size={18} />
          <span>Actual</span>
          <strong>{formatMoney(budget.actualTotalMinor, budget.currency)}</strong>
        </article>
        <article data-negative={!remainingPositive}>
          {remainingPositive ? (
            <ArrowUpRight aria-hidden="true" size={18} />
          ) : (
            <ArrowDownRight aria-hidden="true" size={18} />
          )}
          <span>Remaining</span>
          <strong>{formatMoney(budget.remainingTotalMinor, budget.currency)}</strong>
        </article>
      </section>

      {budget.isClosed ? (
        <section className="budget-lock-notice" role="status">
          <LockKeyhole aria-hidden="true" size={20} />
          <div>
            <strong>This budget is part of a closed report revision.</strong>
            <p>Reopen the month before changing any target.</p>
          </div>
          <Link
            className="secondary-button"
            href={"/month-close?month=" + budget.targetMonth}
          >
            View close
          </Link>
        </section>
      ) : (
        <CopyBudgetForm budget={budget} />
      )}

      <section className="budget-category-panel">
        <div className="section-heading">
          <div>
            <p className="card-kicker">Planned versus actual</p>
            <h2>Expense categories</h2>
          </div>
          <span>{budget.categories.length}</span>
        </div>
        <div className="budget-category-list">
          {budget.categories.map((category) => (
            <article data-status={category.status} key={category.categoryId}>
              <div className="budget-category-row__identity">
                <strong>{category.categoryName}</strong>
                <small>
                  {category.transactionCount} posted transaction
                  {category.transactionCount === 1 ? "" : "s"}
                  {category.categoryArchivedAt ? " · archived" : ""}
                </small>
              </div>
              <div className="budget-category-row__actual">
                <span>Actual</span>
                <strong>{formatMoney(category.actualMinor, budget.currency)}</strong>
              </div>
              <div className="budget-category-row__remaining">
                <span>Remaining</span>
                <strong>
                  {category.remainingMinor === null
                    ? "No target"
                    : formatMoney(category.remainingMinor, budget.currency)}
                </strong>
              </div>
              <BudgetTargetForm budget={budget} category={category} />
              {category.transactionCount > 0 ? (
                <Link
                  className="text-link"
                  href={
                    "/month-close?month=" + budget.targetMonth + "#spending-by-category"
                  }
                >
                  Trace actual
                </Link>
              ) : null}
            </article>
          ))}
        </div>
        {budget.categories.length === 0 ? (
          <div className="compact-empty">
            <CalendarRange aria-hidden="true" size={22} />
            <h2>No expense categories</h2>
            <p>Create an expense category before setting monthly targets.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
