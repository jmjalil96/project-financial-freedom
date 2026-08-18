"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";

import { createCategoryAction } from "@/features/categories/actions";
import { initialFormActionState } from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";

export function CategoryForm() {
  const { state, onSubmit, isPending } = usePreservingActionState(
    createCategoryAction,
    initialFormActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <form className="category-form" onSubmit={onSubmit} ref={formRef}>
      <label className="field">
        <span>Category name</span>
        <input
          autoComplete="off"
          maxLength={60}
          name="name"
          placeholder="e.g. Education"
          required
        />
      </label>
      <label className="field">
        <span>Type</span>
        <select defaultValue="expense" name="kind">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </label>
      <button className="primary-button" disabled={isPending} type="submit">
        <Plus aria-hidden="true" size={16} />
        {isPending ? "Adding…" : "Add category"}
      </button>
      {state.message ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
