import { z } from "zod";

export const dispositions = ["accepted", "excluded", "duplicate"] as const;
export const dispositionSchema = z.enum(dispositions);
export type Disposition = z.infer<typeof dispositionSchema>;

export const confirmedTypes = [
  "income",
  "expense",
  "refund",
  "transfer",
  "adjustment",
] as const;
export const confirmedTypeSchema = z.enum(confirmedTypes);
export type ConfirmedType = z.infer<typeof confirmedTypeSchema>;

export const inboxFilters = [
  "needs_category",
  "unknown_type",
  "suspected_duplicate",
  "possible_transfer",
  "date_uncertainty",
  "reconciliation_blocker",
  "ready_to_finalize",
] as const;
export const inboxFilterSchema = z.enum(inboxFilters);
export type InboxFilter = z.infer<typeof inboxFilterSchema>;
