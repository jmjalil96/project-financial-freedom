"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { minorUnitsToDecimalInput } from "@/domain/money";
import {
  confirmedTypes,
  deriveDefaultEffectiveDate,
  dispositions,
  isSelectableDuplicateCandidate,
  type CategoryKind,
  type ConfirmedType,
  type Disposition,
} from "@/domain/review";
import {
  initialFormActionState,
  type FormActionState,
} from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";
import { saveRowDecisionAction } from "@/features/reconciliation/actions";
import type {
  ReviewCategory,
  ReviewRowView,
} from "@/features/reconciliation/review-service";

const dispositionLabels: Record<Disposition, { label: string; description: string }> = {
  accepted: {
    label: "Accept",
    description: "Count this source row in statement activity.",
  },
  excluded: {
    label: "Exclude",
    description: "Keep the evidence, but omit it from activity.",
  },
  duplicate: {
    label: "Duplicate",
    description: "Link this row to an accepted canonical row.",
  },
};

const typeLabels: Record<ConfirmedType, string> = {
  income: "Income",
  expense: "Expense",
  refund: "Refund",
  transfer: "Transfer",
  adjustment: "Adjustment",
};

type AllocationDraft = {
  key: number;
  categoryId: number | "";
  amount: string;
  archivedCategoryName?: string;
};

function categoryKindForType(type: ConfirmedType | ""): CategoryKind | null {
  if (type === "income") {
    return "income";
  }
  if (type === "expense" || type === "refund") {
    return "expense";
  }
  return null;
}

function initialAllocationDrafts(
  row: ReviewRowView,
  categories: readonly ReviewCategory[],
  type: ConfirmedType | "",
): AllocationDraft[] {
  const kind = categoryKindForType(type);
  if (!kind) {
    return [];
  }

  const saved = row.decision.allocations.filter(
    (allocation) => allocation.categoryKind === kind,
  );
  if (saved.length > 0) {
    return saved.map((allocation) => ({
      key: allocation.categoryId,
      categoryId: allocation.category.archivedAt === null ? allocation.categoryId : "",
      amount: minorUnitsToDecimalInput(allocation.amountMinor, row.currency),
      archivedCategoryName:
        allocation.category.archivedAt === null ? undefined : allocation.category.name,
    }));
  }

  const suggestedCategory = categories.find(
    (category) => category.id === row.suggestedCategoryId && category.kind === kind,
  );

  return [
    {
      key: -1,
      categoryId: suggestedCategory?.id ?? "",
      amount: minorUnitsToDecimalInput(Math.abs(row.amountMinor), row.currency),
    },
  ];
}

export function DecisionForm({
  categories,
  finalized,
  row,
}: {
  categories: readonly ReviewCategory[];
  finalized: boolean;
  row: ReviewRowView;
}) {
  const initialType = row.decision.confirmedType ?? row.suggestedType ?? "";
  const [disposition, setDisposition] = useState<Disposition | "">(
    row.decision.disposition ?? "",
  );
  const [confirmedType, setConfirmedType] = useState<ConfirmedType | "">(initialType);
  const [effectiveDate, setEffectiveDate] = useState(
    row.decision.effectiveDate ??
      deriveDefaultEffectiveDate({
        accountType: row.account.type,
        transactionType: initialType || null,
        transactionDate: row.transactionDate,
        postedDate: row.postedDate,
        amountMinor: row.amountMinor,
      }),
  );
  const effectiveDateEdited = useRef(row.decision.effectiveDate !== null);
  const [allocations, setAllocations] = useState<AllocationDraft[]>(() =>
    initialAllocationDrafts(row, categories, initialType),
  );
  const nextAllocationKey = useRef(-2);
  const { state, onSubmit, isPending } = usePreservingActionState<FormActionState>(
    saveRowDecisionAction,
    initialFormActionState,
  );
  const allocationKind = categoryKindForType(confirmedType);
  const availableCategories = allocationKind
    ? categories.filter((category) => category.kind === allocationKind)
    : [];
  const selectableDuplicateCandidates = row.duplicateCandidates.filter((candidate) =>
    isSelectableDuplicateCandidate(candidate.status),
  );
  const disabled = finalized || isPending;
  const allocationsIncomplete =
    allocationKind !== null &&
    (row.amountMinor === 0 ||
      allocations.length === 0 ||
      allocations.some(
        (allocation) => allocation.categoryId === "" || allocation.amount.trim() === "",
      ));

  function handleTypeChange(nextType: ConfirmedType | "") {
    const previousKind = categoryKindForType(confirmedType);
    const nextKind = categoryKindForType(nextType);
    setConfirmedType(nextType);
    if (!effectiveDateEdited.current) {
      setEffectiveDate(
        deriveDefaultEffectiveDate({
          accountType: row.account.type,
          transactionType: nextType || null,
          transactionDate: row.transactionDate,
          postedDate: row.postedDate,
          amountMinor: row.amountMinor,
        }),
      );
    }

    if (nextKind !== previousKind || (nextKind && allocations.length === 0)) {
      setAllocations(initialAllocationDrafts(row, categories, nextType));
    }
  }

  function addAllocation() {
    const key = nextAllocationKey.current;
    nextAllocationKey.current -= 1;
    setAllocations((current) => [
      ...current,
      {
        key,
        categoryId: "",
        amount: minorUnitsToDecimalInput(0, row.currency),
      },
    ]);
  }

  function updateAllocation(
    key: number,
    field: "categoryId" | "amount",
    value: string,
  ) {
    setAllocations((current) =>
      current.map((allocation) =>
        allocation.key === key
          ? {
              ...allocation,
              [field]:
                field === "categoryId" ? (value === "" ? "" : Number(value)) : value,
            }
          : allocation,
      ),
    );
  }

  return (
    <form className="decision-form" onSubmit={onSubmit}>
      <input name="importRowId" type="hidden" value={row.id} />
      <div className="decision-form__heading">
        <div>
          <p className="card-kicker">Decision overlay</p>
          <h3>Classify source row {row.originalRowNumber}</h3>
        </div>
        {finalized ? (
          <span className="read-only-chip">Finalized · read only</span>
        ) : null}
      </div>

      <fieldset className="decision-form__fields" disabled={disabled}>
        <legend>Disposition</legend>
        <div className="disposition-picker">
          {dispositions.map((value) => (
            <label key={value}>
              <input
                checked={disposition === value}
                name="disposition"
                onChange={() => setDisposition(value)}
                required
                type="radio"
                value={value}
              />
              <span>
                <strong>{dispositionLabels[value].label}</strong>
                <small>{dispositionLabels[value].description}</small>
              </span>
            </label>
          ))}
        </div>

        {disposition === "accepted" ? (
          <div className="decision-form__accepted">
            <div className="decision-form__grid">
              <label className="field">
                <span>Confirmed type</span>
                <select
                  name="confirmedType"
                  onChange={(event) =>
                    handleTypeChange(event.target.value as ConfirmedType | "")
                  }
                  required
                  value={confirmedType}
                >
                  <option disabled value="">
                    Choose the transaction type
                  </option>
                  {confirmedTypes.map((type) => (
                    <option key={type} value={type}>
                      {typeLabels[type]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Effective date</span>
                <input
                  min={row.account.openingDate}
                  name="effectiveDate"
                  onChange={(event) => {
                    effectiveDateEdited.current = true;
                    setEffectiveDate(event.target.value);
                  }}
                  required
                  type="date"
                  value={effectiveDate}
                />
              </label>

              <label className="field decision-form__wide">
                <span>Normalized merchant</span>
                <input
                  defaultValue={row.decision.normalizedMerchant ?? row.merchant ?? ""}
                  maxLength={140}
                  name="normalizedMerchant"
                  placeholder="Optional cleaned merchant name"
                />
              </label>
            </div>

            {allocationKind ? (
              <section
                aria-labelledby={`allocations-${row.id}`}
                className="allocation-editor"
              >
                <div className="allocation-editor__heading">
                  <div>
                    <h4 id={`allocations-${row.id}`}>Category allocation</h4>
                    <p>
                      Allocate exactly{" "}
                      <strong>
                        {minorUnitsToDecimalInput(
                          Math.abs(row.amountMinor),
                          row.currency,
                        )}{" "}
                        {row.currency}
                      </strong>{" "}
                      across {allocationKind} categories.
                    </p>
                  </div>
                  <button
                    className="quiet-button"
                    disabled={disabled}
                    onClick={addAllocation}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={13} />
                    Add allocation
                  </button>
                </div>

                {allocations.length > 0 ? (
                  <div className="allocation-editor__rows">
                    {allocations.map((allocation, index) => (
                      <div className="allocation-row" key={allocation.key}>
                        <label className="field">
                          <span>Category {index + 1}</span>
                          <select
                            name="categoryIds"
                            onChange={(event) =>
                              updateAllocation(
                                allocation.key,
                                "categoryId",
                                event.target.value,
                              )
                            }
                            required
                            value={allocation.categoryId}
                          >
                            <option disabled value="">
                              {allocation.archivedCategoryName
                                ? `Replace archived category: ${allocation.archivedCategoryName}`
                                : `Choose ${allocationKind} category`}
                            </option>
                            {availableCategories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Amount</span>
                          <div className="money-input">
                            <span>{row.currency}</span>
                            <input
                              inputMode="decimal"
                              name="categoryAmounts"
                              onChange={(event) =>
                                updateAllocation(
                                  allocation.key,
                                  "amount",
                                  event.target.value,
                                )
                              }
                              required
                              value={allocation.amount}
                            />
                          </div>
                        </label>
                        <button
                          aria-label={`Remove category allocation ${index + 1}`}
                          className="icon-button"
                          disabled={disabled}
                          onClick={() =>
                            setAllocations((current) =>
                              current.filter((item) => item.key !== allocation.key),
                            )
                          }
                          title="Remove allocation"
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="allocation-editor__empty">
                    Add at least one {allocationKind} category allocation.
                  </p>
                )}
                {row.amountMinor === 0 ? (
                  <p className="form-error">
                    Zero-amount rows cannot use income, expense, or refund categories.
                    Exclude the row or review it as a transfer or adjustment.
                  </p>
                ) : null}
              </section>
            ) : null}

            {confirmedType === "transfer" ? (
              <p className="decision-form__type-note">
                Transfers preserve the full source amount and do not use a category.
              </p>
            ) : null}

            <label className="field">
              <span>
                {confirmedType === "adjustment"
                  ? "Adjustment evidence note"
                  : "Review note"}
              </span>
              <textarea
                defaultValue={row.decision.note ?? ""}
                maxLength={500}
                name="reviewNote"
                placeholder={
                  confirmedType === "adjustment"
                    ? "Explain the source evidence supporting this adjustment."
                    : "Optional note about the review decision"
                }
                required={confirmedType === "adjustment"}
              />
            </label>
          </div>
        ) : null}

        {disposition === "excluded" ? (
          <label className="field">
            <span>Exclusion reason</span>
            <textarea
              defaultValue={row.decision.exclusionReason ?? ""}
              maxLength={500}
              name="exclusionReason"
              placeholder="Explain why this source row must not affect statement activity."
              required
            />
          </label>
        ) : null}

        {disposition === "duplicate" ? (
          <fieldset className="canonical-picker">
            <legend>Canonical source row</legend>
            {selectableDuplicateCandidates.length > 0 ? (
              <div>
                {selectableDuplicateCandidates.map((candidate) => (
                  <label key={candidate.id}>
                    <input
                      defaultChecked={
                        row.decision.duplicateOfRowId === candidate.candidateImportRowId
                      }
                      name="duplicateOfImportRowId"
                      required
                      type="radio"
                      value={candidate.candidateImportRowId}
                    />
                    <span>
                      <strong>
                        Row {candidate.candidate.originalRowNumber} ·{" "}
                        {candidate.candidate.description}
                      </strong>
                      <small>
                        {candidate.candidate.transactionDate} ·{" "}
                        {minorUnitsToDecimalInput(
                          candidate.candidate.amountMinor,
                          candidate.candidate.currency,
                        )}{" "}
                        {candidate.candidate.currency} · {candidate.status}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p>No duplicate candidate is available for this row.</p>
            )}
          </fieldset>
        ) : null}

        <button
          className="primary-button decision-form__save"
          disabled={
            disabled ||
            disposition === "" ||
            (disposition === "accepted" && allocationsIncomplete)
          }
          type="submit"
        >
          <Check aria-hidden="true" size={16} />
          {isPending ? "Saving row decision…" : "Save row decision"}
        </button>
      </fieldset>

      {state.status !== "idle" ? (
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
