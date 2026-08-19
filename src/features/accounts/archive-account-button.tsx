"use client";

import { Archive } from "lucide-react";
import { useActionState } from "react";

import { archiveAccountAction } from "@/features/accounts/actions";
import { initialFormActionState } from "@/features/forms/action-state";

type ArchiveAccountButtonProps = {
  accountId: number;
  accountName: string;
  defaultArchivedOn: string;
  disabled: boolean;
  openingDate: string;
};

export function ArchiveAccountButton({
  accountId,
  accountName,
  defaultArchivedOn,
  disabled,
  openingDate,
}: ArchiveAccountButtonProps) {
  const [state, formAction, isPending] = useActionState(
    archiveAccountAction,
    initialFormActionState,
  );

  return (
    <div className="account-archive-action">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              `Archive ${accountName} on the selected closing date? Its history will remain visible.`,
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input name="accountId" type="hidden" value={accountId} />
        <label>
          <span>Closing date</span>
          <input
            aria-label={`Closing date for ${accountName}`}
            defaultValue={defaultArchivedOn}
            disabled={disabled || isPending}
            max={defaultArchivedOn}
            min={openingDate}
            name="archivedOn"
            required
            type="date"
          />
        </label>
        <button
          aria-label={`Archive ${accountName}`}
          className="quiet-button"
          disabled={disabled || isPending}
          title={
            disabled
              ? "Bring the account balance to zero before archiving."
              : `Archive ${accountName}`
          }
          type="submit"
        >
          <Archive aria-hidden="true" size={14} />
          {isPending ? "Archiving…" : "Archive"}
        </button>
      </form>
      {state.status === "error" ? (
        <p className="inline-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
