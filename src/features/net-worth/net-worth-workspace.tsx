"use client";

import {
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CircleAlert,
  Landmark,
  Link2,
  Plus,
  RefreshCcw,
  Scale,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { formatCalendarDate } from "@/domain/calendar-date";
import type { BaseCurrency } from "@/domain/currencies";
import { formatMoney } from "@/domain/money";
import { valuationFrequencyLabels } from "@/domain/net-worth";
import { EntityStatusButton } from "@/features/forms/entity-status-button";
import {
  initialFormActionState,
  type FormActionState,
} from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";
import {
  archiveManualItemAction,
  carryForwardManualValuationAction,
  createManualItemAction,
  recordManualValuationAction,
  restoreManualItemAction,
  setOutsideScopeTransferManualItemAction,
} from "@/features/net-worth/actions";
import type {
  ManualItemView,
  NetWorthSnapshot,
  OutsideScopeTransferAssignment,
} from "@/features/net-worth/net-worth-service";

function ActionMessage({ state }: { state: FormActionState }) {
  return state.status === "idle" ? null : (
    <p
      className={`form-message form-message--${state.status}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function ManualItemForm({ defaultDate }: { defaultDate: string }) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    createManualItemAction,
    initialFormActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);
  return (
    <form className="data-form net-worth-item-form" onSubmit={onSubmit} ref={formRef}>
      <div className="data-form__heading">
        <div>
          <p className="card-kicker">Value-only tracking</p>
          <h2>Add a manual item</h2>
        </div>
        <Scale aria-hidden="true" size={20} />
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Item name</span>
          <input maxLength={80} name="name" placeholder="Home" required />
        </label>
        <label className="field">
          <span>Classification</span>
          <select defaultValue="asset" name="kind">
            <option value="asset">Asset owned</option>
            <option value="liability">Amount owed</option>
          </select>
        </label>
        <label className="field">
          <span>Tracking since</span>
          <input defaultValue={defaultDate} name="openingDate" required type="date" />
        </label>
        <label className="field">
          <span>Valuation frequency</span>
          <select defaultValue="monthly" name="valuationFrequency">
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
            <option value="ad_hoc">As needed</option>
          </select>
        </label>
        <label className="field form-grid__wide">
          <span>Description</span>
          <textarea
            maxLength={240}
            name="description"
            placeholder="Optional context about what is being valued"
            rows={2}
          />
        </label>
      </div>
      <ActionMessage state={state} />
      <button className="primary-button" disabled={isPending} type="submit">
        <Plus aria-hidden="true" size={16} />
        {isPending ? "Adding…" : "Add manual item"}
      </button>
    </form>
  );
}

function ValuationEditor({
  item,
  defaultDate,
  currency,
}: {
  item: ManualItemView;
  defaultDate: string;
  currency: BaseCurrency;
}) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    recordManualValuationAction,
    initialFormActionState,
  );
  return (
    <>
      <details className="manual-item-card__details" open={!item.latestValuation}>
        <summary>Record a dated value</summary>
        <form className="manual-valuation-form" onSubmit={onSubmit}>
          <input name="manualItemId" type="hidden" value={item.id} />
          <div className="manual-valuation-form__grid">
            <label>
              <span>As-of date</span>
              <input
                defaultValue={defaultDate}
                max={defaultDate}
                min={item.openingDate}
                name="effectiveDate"
                required
                type="date"
              />
            </label>
            <label>
              <span>{item.kind === "liability" ? "Amount owed" : "Value"}</span>
              <div className="money-input">
                <span>{currency}</span>
                <input inputMode="decimal" min="0" name="value" required />
              </div>
            </label>
            <label className="manual-valuation-form__note">
              <span>Source note</span>
              <input
                maxLength={500}
                name="sourceNote"
                placeholder="Statement, appraisal, estimate method…"
                required
              />
            </label>
          </div>
          <button className="secondary-button" disabled={isPending} type="submit">
            <Plus aria-hidden="true" size={15} />
            {isPending ? "Recording…" : "Record valuation"}
          </button>
        </form>
      </details>
      <ActionMessage state={state} />
    </>
  );
}

function CarryForwardForm({
  item,
  defaultDate,
}: {
  item: ManualItemView;
  defaultDate: string;
}) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    carryForwardManualValuationAction,
    initialFormActionState,
  );
  if (!item.latestValuation || item.latestValuation.effectiveDate >= defaultDate) {
    return <ActionMessage state={state} />;
  }
  return (
    <form className="manual-carry-form" onSubmit={onSubmit}>
      <input name="manualItemId" type="hidden" value={item.id} />
      <input name="sourceValuationId" type="hidden" value={item.latestValuation.id} />
      <label>
        <span>Carry to</span>
        <input
          defaultValue={defaultDate}
          max={defaultDate}
          min={item.latestValuation.effectiveDate}
          name="effectiveDate"
          required
          type="date"
        />
      </label>
      <label>
        <span>Why this value still applies</span>
        <input maxLength={500} name="acknowledgment" required />
      </label>
      <button className="text-button" disabled={isPending} type="submit">
        <RefreshCcw aria-hidden="true" size={14} />
        {isPending ? "Carrying…" : "Carry forward"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function ArchiveManualItemForm({
  item,
  today,
}: {
  item: ManualItemView;
  today: string;
}) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    archiveManualItemAction,
    initialFormActionState,
  );
  return (
    <form className="manual-item-archive" onSubmit={onSubmit}>
      <input name="manualItemId" type="hidden" value={item.id} />
      <label>
        <span>Final active date</span>
        <input
          defaultValue={today}
          max={today}
          min={item.openingDate}
          name="archivedOn"
          required
          type="date"
        />
      </label>
      <button
        className="quiet-button"
        disabled={isPending}
        onClick={(event) => {
          if (!window.confirm(`Archive ${item.name} and preserve its valuations?`)) {
            event.preventDefault();
          }
        }}
        type="submit"
      >
        <Archive aria-hidden="true" size={14} />
        {isPending ? "Archiving…" : "Archive"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function ManualItemCard({
  item,
  currency,
  defaultDate,
  today,
}: {
  item: ManualItemView;
  currency: BaseCurrency;
  defaultDate: string;
  today: string;
}) {
  const archived = item.archivedAt !== null;
  const status = !item.latestValuation
    ? "missing"
    : item.isStale
      ? "stale"
      : item.latestValuation.carriedForwardFromValuationId
        ? "carried"
        : "current";
  return (
    <article className="manual-item-card" data-archived={archived} data-status={status}>
      <header>
        <span className="manual-item-card__icon">
          {item.kind === "asset" ? (
            <Building2 aria-hidden="true" size={18} />
          ) : (
            <WalletCards aria-hidden="true" size={18} />
          )}
        </span>
        <div>
          <p>{item.kind === "asset" ? "Manual asset" : "Manual liability"}</p>
          <h3>{item.name}</h3>
        </div>
        <span className="type-chip">
          {valuationFrequencyLabels[item.valuationFrequency]}
        </span>
      </header>
      {item.description ? (
        <p className="manual-item-card__description">{item.description}</p>
      ) : null}
      <div className="manual-item-card__value">
        <span>{item.kind === "liability" ? "Latest amount owed" : "Latest value"}</span>
        <strong>
          {item.latestValuation
            ? formatMoney(item.latestValuation.naturalValueMinor, currency)
            : "Missing valuation"}
        </strong>
        {item.latestValuation ? (
          <small>
            As of {formatCalendarDate(item.latestValuation.effectiveDate)} · {status}
          </small>
        ) : (
          <small>Tracking began {formatCalendarDate(item.openingDate)}</small>
        )}
      </div>
      {item.latestValuation ? (
        <div className="manual-item-card__evidence">
          <ShieldCheck aria-hidden="true" size={15} />
          <span>{item.latestValuation.sourceNote}</span>
        </div>
      ) : null}
      {item.valuationHistory.length > 0 ? (
        <details className="manual-item-history">
          <summary>
            Valuation history <span>{item.valuationCount}</span>
          </summary>
          <ol>
            {item.valuationHistory.map((valuation) => (
              <li data-superseded={valuation.isSuperseded} key={valuation.id}>
                <div>
                  <strong>{formatMoney(valuation.naturalValueMinor, currency)}</strong>
                  <span>{formatCalendarDate(valuation.effectiveDate)}</span>
                </div>
                <p>{valuation.sourceNote}</p>
                <small>
                  {valuation.isSuperseded
                    ? "Superseded correction evidence"
                    : valuation.carriedForwardFromValuationId
                      ? `Carried forward from valuation #${valuation.carriedForwardFromValuationId}`
                      : valuation.origin === "imported"
                        ? "Imported evidence"
                        : "Manual evidence"}
                </small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {!archived ? (
        <>
          <ValuationEditor currency={currency} defaultDate={defaultDate} item={item} />
          <CarryForwardForm defaultDate={defaultDate} item={item} />
          <ArchiveManualItemForm item={item} today={today} />
        </>
      ) : (
        <div className="manual-item-card__archived">
          <span>
            Archived {item.archivedOn ? formatCalendarDate(item.archivedOn) : ""}
          </span>
          <EntityStatusButton
            accessibleLabel={`Restore ${item.name}`}
            action={restoreManualItemAction}
            entityId={item.id}
            fieldName="manualItemId"
            icon="restore"
            label="Restore"
            pendingLabel="Restoring…"
          />
        </div>
      )}
    </article>
  );
}

function OutsideScopeLinkForm({
  transfer,
  manualItems,
}: {
  transfer: OutsideScopeTransferAssignment;
  manualItems: ManualItemView[];
}) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    setOutsideScopeTransferManualItemAction,
    initialFormActionState,
  );
  return (
    <article className="outside-scope-link-row">
      <div>
        <span>{formatCalendarDate(transfer.effectiveDate)}</span>
        <strong>{transfer.description}</strong>
        <small>
          {transfer.accountName} ·{" "}
          {formatMoney(transfer.amountMinor, transfer.currency)}
        </small>
      </div>
      <form onSubmit={onSubmit}>
        <input
          name="transferResolutionId"
          type="hidden"
          value={transfer.resolutionId}
        />
        <label>
          <span>Represented by</span>
          <select defaultValue={transfer.manualItemId ?? ""} name="manualItemId">
            <option value="">No manual valuation</option>
            {manualItems
              .filter((item) => !item.archivedAt)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <button className="secondary-button" disabled={isPending} type="submit">
          <Link2 aria-hidden="true" size={14} />
          {isPending ? "Saving…" : "Save link"}
        </button>
        <ActionMessage state={state} />
      </form>
    </article>
  );
}

export function NetWorthWorkspace({
  snapshot,
  outsideScopeTransfers,
  today,
}: {
  snapshot: NetWorthSnapshot;
  outsideScopeTransfers: OutsideScopeTransferAssignment[];
  today: string;
}) {
  const defaultDate = snapshot.monthEnd < today ? snapshot.monthEnd : today;
  const activeItems = snapshot.manualItems.filter((item) => !item.archivedAt);
  const changeIsPositive = snapshot.changeMinor >= 0;
  return (
    <main className="net-worth-workspace">
      <header className="net-worth-hero">
        <div>
          <p className="eyebrow">Month-end position</p>
          <h1>Net worth at {formatCalendarDate(snapshot.monthEnd)}</h1>
          <p>
            Ledger balances and the latest valid manual valuations meet here without
            turning valuation changes into income or expense.
          </p>
        </div>
        <form className="coverage-month-form">
          <label htmlFor="net-worth-month">Target month</label>
          <input
            defaultValue={snapshot.targetMonth}
            id="net-worth-month"
            name="month"
            type="month"
          />
          <button className="primary-button" type="submit">
            View month-end
          </button>
        </form>
      </header>

      <section className="net-worth-summary" aria-label="Net worth summary">
        <article className="net-worth-summary__primary">
          <span>Net worth</span>
          <strong>{formatMoney(snapshot.netWorthMinor, snapshot.currency)}</strong>
          <small data-positive={changeIsPositive}>
            {changeIsPositive ? (
              <ArrowUpRight aria-hidden="true" size={14} />
            ) : (
              <ArrowDownRight aria-hidden="true" size={14} />
            )}
            {formatMoney(snapshot.changeMinor, snapshot.currency)} from prior month
          </small>
        </article>
        <article>
          <span>Total debt</span>
          <strong>{formatMoney(snapshot.debtMinor, snapshot.currency)}</strong>
          <small>
            {formatMoney(snapshot.debtChangeMinor, snapshot.currency)} from prior month
          </small>
        </article>
        <article>
          <span>Valuation readiness</span>
          <strong>
            {snapshot.missingValuationCount + snapshot.staleValuationCount === 0
              ? "Current"
              : `${snapshot.missingValuationCount + snapshot.staleValuationCount} need attention`}
          </strong>
          <small>
            {snapshot.missingValuationCount} missing · {snapshot.staleValuationCount}{" "}
            stale
          </small>
        </article>
      </section>

      {snapshot.missingValuationCount + snapshot.staleValuationCount > 0 ? (
        <section className="net-worth-readiness" role="status">
          <CircleAlert aria-hidden="true" size={20} />
          <div>
            <strong>This month-end remains valuation-incomplete.</strong>
            <p>
              Record new evidence or explicitly carry an appropriate prior value
              forward. Phase 7 will use this exact readiness signal for month close.
            </p>
          </div>
        </section>
      ) : null}

      <section className="net-worth-components">
        <div className="section-heading">
          <div>
            <p className="card-kicker">Reproducible total</p>
            <h2>Position components</h2>
          </div>
          <span>{snapshot.components.length}</span>
        </div>
        <div className="net-worth-component-list">
          {snapshot.components.map((component) => (
            <article key={component.key}>
              <span className="net-worth-component-list__icon">
                {component.kind === "liability" ? (
                  <WalletCards aria-hidden="true" size={16} />
                ) : component.kind === "asset" ? (
                  <Landmark aria-hidden="true" size={16} />
                ) : (
                  <Scale aria-hidden="true" size={16} />
                )}
              </span>
              <div>
                <strong>{component.name}</strong>
                <small>
                  {component.source.type === "manual_valuation"
                    ? `Valuation ${formatCalendarDate(component.source.valuationDate)} · ${component.source.sourceNote}`
                    : component.source.type === "ledger_account"
                      ? "Posted financial-account ledger"
                      : "Transfer explanation ledger"}
                </small>
              </div>
              <strong data-negative={component.amountMinor < 0}>
                {formatMoney(component.amountMinor, snapshot.currency)}
              </strong>
            </article>
          ))}
          {snapshot.components.length === 0 ? (
            <div className="compact-empty">
              <Scale aria-hidden="true" size={22} />
              <h2>No position evidence yet</h2>
              <p>Add an account or manual valuation applicable to this month.</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="net-worth-manual-layout">
        <div>
          <div className="section-heading">
            <div>
              <p className="card-kicker">Dated evidence</p>
              <h2>Manual assets and liabilities</h2>
            </div>
            <span>{snapshot.manualItems.length}</span>
          </div>
          <div className="manual-item-grid">
            {snapshot.manualItems.map((item) => (
              <ManualItemCard
                currency={snapshot.currency}
                defaultDate={defaultDate}
                item={item}
                key={item.id}
                today={today}
              />
            ))}
          </div>
        </div>
        <aside>
          <ManualItemForm defaultDate={defaultDate} />
        </aside>
      </section>

      <section className="outside-scope-links">
        <div className="section-heading">
          <div>
            <p className="card-kicker">No double-counting</p>
            <h2>Outside-scope transfer links</h2>
          </div>
          <span>{outsideScopeTransfers.length}</span>
        </div>
        <p className="outside-scope-links__intro">
          Link a transfer when its destination or source is already represented by a
          complete manual valuation. Until that item has a valuation for the selected
          month, the transfer balance remains included so value does not disappear.
        </p>
        {outsideScopeTransfers.length > 0 ? (
          <div className="outside-scope-link-list">
            {outsideScopeTransfers.map((transfer) => (
              <OutsideScopeLinkForm
                key={transfer.resolutionId}
                manualItems={activeItems}
                transfer={transfer}
              />
            ))}
          </div>
        ) : (
          <div className="compact-empty">
            <Link2 aria-hidden="true" size={22} />
            <h2>No outside-scope transfers to link</h2>
            <p>
              Owned accounts outside the workspace will appear here after
              classification.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
