"use client";

import { startTransition, useActionState, type FormEventHandler } from "react";

export function usePreservingActionState<State>(
  action: (state: Awaited<State>, payload: FormData) => State | Promise<State>,
  initialState: Awaited<State>,
): {
  state: Awaited<State>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  isPending: boolean;
} {
  const [state, dispatch, isPending] = useActionState(action, initialState);

  const onSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(() => {
      dispatch(formData);
    });
  };

  return { state, onSubmit, isPending };
}
