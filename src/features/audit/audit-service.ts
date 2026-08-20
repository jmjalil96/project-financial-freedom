import { auditEvents } from "@/db/schema";
import type { AppTransaction } from "@/db/types";

export type AuditAction =
  | "settings.base_currency_initialized"
  | "settings.base_currency_changed"
  | "account.created"
  | "account.archived"
  | "account.restored"
  | "category.created"
  | "category.archived"
  | "category.restored"
  | "import.committed"
  | "import.batch_posted"
  | "review.row_decision_saved"
  | "review.duplicate_candidate_dismissed"
  | "transfer.resolution_saved"
  | "transfer.match_confirmed"
  | "transfer.manual_item_link_changed"
  | "manual_item.created"
  | "manual_item.archived"
  | "manual_item.restored"
  | "manual_item.valuation_recorded"
  | "budget.target_set"
  | "month.closed"
  | "month.reopened"
  | "review.batch_finalized"
  | "journal.posted"
  | "journal.reversed";

export function recordAuditEvent(
  transaction: AppTransaction,
  input: {
    action: AuditAction;
    entityType:
      | "application_settings"
      | "financial_account"
      | "category"
      | "import_batch"
      | "import_row"
      | "manual_item"
      | "manual_item_valuation"
      | "monthly_budget"
      | "month_close_revision"
      | "duplicate_candidate"
      | "journal_entry";
    entityId: number;
    details: Record<string, unknown>;
  },
): void {
  transaction
    .insert(auditEvents)
    .values({
      action: input.action,
      entityType: input.entityType,
      entityId: String(input.entityId),
      detailsJson: JSON.stringify(input.details),
    })
    .run();
}
