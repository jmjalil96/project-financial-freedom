"use client";

import { RotateCcw } from "lucide-react";
import { useActionState } from "react";

import { initialFormActionState } from "@/features/forms/action-state";
import { reverseJournalEntryAction } from "@/features/transactions/actions";

type ReversalFormProps = {
  journalEntryId: number;
};

export function ReversalForm({ journalEntryId }: ReversalFormProps) {
  const [state, action, isPending] = useActionState(
    reverseJournalEntryAction,
    initialFormActionState,
  );

  return (
    <details className="reversal-form">
      <summary>
        <RotateCcw aria-hidden="true" size={13} />
        Reverse entry
      </summary>
      <form action={action}>
        <input name="journalEntryId" type="hidden" value={journalEntryId} />
        <label className="field">
          <span>Reason</span>
          <input
            maxLength={240}
            name="reason"
            placeholder="Why is this entry incorrect?"
            required
          />
        </label>
        {state.message ? (
          <p
            className={`form-message form-message--${state.status}`}
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        ) : null}
        <button className="danger-button" disabled={isPending} type="submit">
          {isPending ? "Posting reversal…" : "Post balanced reversal"}
        </button>
      </form>
    </details>
  );
}
