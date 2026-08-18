export type FormActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
};

export const initialFormActionState: FormActionState = {
  status: "idle",
  message: null,
};
