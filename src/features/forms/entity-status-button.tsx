"use client";

import { Archive, RotateCcw } from "lucide-react";
import { useActionState } from "react";

import {
  initialFormActionState,
  type FormActionState,
} from "@/features/forms/action-state";

type EntityAction = (
  previousState: FormActionState,
  formData: FormData,
) => Promise<FormActionState>;

export function EntityStatusButton({
  action,
  fieldName,
  entityId,
  label,
  pendingLabel,
  accessibleLabel,
  title,
  icon,
  className = "quiet-button",
  confirmMessage,
  disabled = false,
}: {
  action: EntityAction;
  fieldName: string;
  entityId: number;
  label?: string;
  pendingLabel?: string;
  accessibleLabel: string;
  title?: string;
  icon: "archive" | "restore";
  className?: string;
  confirmMessage?: string;
  disabled?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, initialFormActionState);
  const Icon = icon === "archive" ? Archive : RotateCcw;

  return (
    <div className="inline-action">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (confirmMessage && !window.confirm(confirmMessage)) {
            event.preventDefault();
          }
        }}
      >
        <input name={fieldName} type="hidden" value={entityId} />
        <button
          aria-label={accessibleLabel}
          className={className}
          disabled={disabled || isPending}
          title={title}
          type="submit"
        >
          <Icon aria-hidden="true" size={className === "icon-button" ? 13 : 14} />
          {label ? (isPending ? pendingLabel : label) : null}
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
