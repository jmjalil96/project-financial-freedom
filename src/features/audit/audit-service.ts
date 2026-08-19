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
