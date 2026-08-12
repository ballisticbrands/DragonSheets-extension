/**
 * The six sync-wizard step bodies. Each is a pure render of WizardState plus a
 * dispatch — all sequencing, validation and persistence lives in SyncWizard.
 *
 * Layout rule for every step: single column, compact rows, nothing wider than
 * the 320px minimum sidebar width.
 */
import { useMemo, useState } from "react";
import { getBackend } from "../../../backend";
import type {
  AmazonAccount,
  FilterOp,
  ReportCatalogEntry,
  SyncFilter,
  SyncPreview,
  Usage,
} from "../../../backend/types";
import { formatNumber } from "../../../lib/format";
import { Badge, Card } from "../../../ui/Card";
import { Button } from "../../../ui/Button";
import { Chip } from "../../../ui/Chip";
import { Checkbox, Radio, Select } from "../../../ui/Field";
import { Input } from "../../../ui/Input";
import { EmptyState } from "../../../ui/Screen";
import { CalculatedColumnsEditor } from "./CalculatedColumnsEditor";
import {
  columnRef,
  commonJoinKeys,
  dateRangeLabel,
  DATE_RANGE_OPTIONS,
  FILTER_OPS,
  findField,
  findReport,
  formulaFields,
  joinKeyLabel,
  scheduleLabel,
  SCHEDULE_OPTIONS,
  splitColumnRef,
  toSyncConfig,
  type WizardAction,
  type WizardState,
} from "./model";

export interface StepProps {
  state: WizardState;
  dispatch: (action: WizardAction) => void;
  reports: ReportCatalogEntry[];
  accounts: AmazonAccount[];
  usage: Usage | null;
  /** Tab names read out of the live Sheets DOM. */
  sheetTabs: string[];
  onConnectAccounts: () => void;
}

// ---------------------------------------------------------------------------
// 1. accounts + marketplaces
// ---------------------------------------------------------------------------

export function StepAccounts({ state, dispatch, accounts, onConnectAccounts }: StepProps) {
  const marketplaces = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const a of accounts) {
      if (!state.accountIds.includes(a.id)) continue;
      for (const m of a.marketplaces) seen.set(m.id, { id: m.id, name: m.name });
    }
    return [...seen.values()];
  }, [accounts, state.accountIds]);

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No Amazon account linked yet"
        description="A sync pulls from Seller Central or Amazon Ads — connect one and this step fills itself in."
        action={<Button onClick={onConnectAccounts}>Connect Amazon</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section>
        <SectionLabel>Accounts</SectionLabel>
        <div className="mt-1 flex flex-col">
          {accounts.map((a) => (
            <Checkbox
              key={a.id}
              checked={state.accountIds.includes(a.id)}
              onChange={() =>
                dispatch({
                  type: "toggleAccount",
                  id: a.id,
                  marketplaceIds: a.marketplaces.map((m) => m.id),
                })
              }
              label={
                <span className="flex items-center gap-1.5">
                  {a.name}
                  <Badge tone="gray">
                    {a.provider === "amazon-ads" ? "Ads" : "Seller Central"}
                  </Badge>
                </span>
              }
              hint={a.externalId}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Marketplaces</SectionLabel>
        {marketplaces.length === 0 ? (
          <p className="mt-1 text-[12px] text-ink/40">Pick an account first.</p>
        ) : (
          <div className="mt-1 flex flex-col">
            {marketplaces.map((m) => (
              <Checkbox
                key={m.id}
                checked={state.marketplaceIds.includes(m.id)}
                onChange={() => dispatch({ type: "toggleMarketplace", id: m.id })}
                label={m.name}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. reports
// ---------------------------------------------------------------------------

export function StepReports({ state, dispatch, reports, accounts }: StepProps) {
  const hasSeller = accounts.some(
    (a) => state.accountIds.includes(a.id) && a.provider === "amazon-selling-partner"
  );
  const hasAds = accounts.some(
    (a) => state.accountIds.includes(a.id) && a.provider === "amazon-ads"
  );

  const groups: Array<{ title: string; source: ReportCatalogEntry["source"]; available: boolean }> = [
    { title: "Seller Central", source: "seller-central", available: hasSeller },
    { title: "Amazon Ads", source: "ads", available: hasAds },
  ];

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.source}>
          <div className="flex items-center justify-between">
            <SectionLabel>{g.title}</SectionLabel>
            {!g.available ? <span className="text-[11px] text-ink/40">No account selected</span> : null}
          </div>
          <div className={`mt-1 flex flex-col ${g.available ? "" : "opacity-40"}`}>
            {reports
              .filter((r) => r.source === g.source)
              .map((r) => (
                <Checkbox
                  key={r.id}
                  disabled={!g.available}
                  checked={state.reportIds.includes(r.id)}
                  onChange={() => dispatch({ type: "toggleReport", report: r, reports })}
                  label={r.name}
                  hint={`${r.description} · ~${formatNumber(r.rowEstimate)} rows / 30d`}
                />
              ))}
          </div>
        </section>
      ))}

      {state.reportIds.length > 1 ? (
        <Card className="border-forest/30 bg-forest/5">
          <div className="text-[12.5px] font-semibold text-deep">
            {state.reportIds.length} reports — they'll be blended into one tab
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink/60">
            You'll pick the join key on the next step.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. columns (+ blending + calculated columns)
// ---------------------------------------------------------------------------

export function StepColumns({ state, dispatch, reports }: StepProps) {
  const selectedReports = state.reportIds
    .map((id) => findReport(reports, id))
    .filter((r): r is ReportCatalogEntry => Boolean(r));
  const joinKeyChoices = commonJoinKeys(reports, state.reportIds);
  const fields = formulaFields(reports, state.columns, state.calculatedColumns);

  return (
    <div className="flex flex-col gap-4">
      {state.reportIds.length > 1 ? (
        <section>
          <SectionLabel>Blend</SectionLabel>
          <div className="mt-1.5">
            <Select
              label="Primary report (drives the rows)"
              value={state.primaryReportId}
              onChange={(e) => dispatch({ type: "primary", reportId: e.target.value })}
            >
              {selectedReports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-2">
            <span className="mb-1 block text-[12px] font-medium text-ink/60">Join on</span>
            {joinKeyChoices.length === 0 ? (
              <p className="text-[11.5px] leading-relaxed text-red-600">
                These reports share no common key. Drop one, or pick reports that
                both carry ASIN, SKU or date.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {joinKeyChoices.map((k) => (
                  <Chip
                    key={k}
                    active={state.joinKeys.includes(k)}
                    onClick={() => dispatch({ type: "toggleJoinKey", key: k })}
                  >
                    {joinKeyLabel(reports, k)}
                  </Chip>
                ))}
              </div>
            )}
            {state.joinKeys.length > 0 ? (
              <p className="mt-1.5 text-[11.5px] text-ink/50">
                Rows matched by {state.joinKeys.map((k) => joinKeyLabel(reports, k)).join(" + ")}.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {selectedReports.map((r) => (
        <ReportColumnGroup key={r.id} report={r} state={state} dispatch={dispatch} />
      ))}

      <section>
        <div className="flex items-center justify-between">
          <SectionLabel>Calculated columns</SectionLabel>
          <span className="text-[11px] text-ink/40">{state.calculatedColumns.length}</span>
        </div>
        <div className="mt-1.5">
          <CalculatedColumnsEditor
            columns={state.calculatedColumns}
            fields={fields}
            onAdd={(column) => dispatch({ type: "addCalculated", column })}
            onUpdate={(column) => dispatch({ type: "updateCalculated", column })}
            onRemove={(id) => dispatch({ type: "removeCalculated", id })}
          />
        </div>
      </section>
    </div>
  );
}

function ReportColumnGroup({
  report,
  state,
  dispatch,
}: {
  report: ReportCatalogEntry;
  state: WizardState;
  dispatch: (action: WizardAction) => void;
}) {
  const [open, setOpen] = useState(true);
  const refs = report.fields.map((f) => columnRef(report.id, f.id));
  const chosen = refs.filter((r) => state.columns.includes(r));
  const allSelected = chosen.length === refs.length;

  return (
    <section className="rounded-xl border border-gray-200">
      <div className="flex items-center gap-1 border-b border-gray-100 px-2 py-1.5">
        <Checkbox
          className="min-w-0 flex-1"
          checked={allSelected}
          indeterminate={chosen.length > 0 && !allSelected}
          onChange={() =>
            dispatch({
              type: "setReportColumns",
              reportId: report.id,
              refs,
              selected: !allSelected,
            })
          }
          label={<span className="font-semibold">{report.name}</span>}
          hint={`${chosen.length} of ${refs.length} columns`}
        />
        <button
          className="shrink-0 rounded px-1.5 py-1 text-[12px] text-ink/40 hover:text-ink focus:outline-none focus:ring-2 focus:ring-forest/30"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${report.name} columns`}
        >
          {open ? "▴" : "▾"}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col px-1 py-1">
          {report.fields.map((f) => {
            const ref = columnRef(report.id, f.id);
            return (
              <Checkbox
                key={ref}
                checked={state.columns.includes(ref)}
                onChange={() => dispatch({ type: "toggleColumn", ref })}
                label={
                  <span className="flex items-center gap-1.5">
                    {f.name}
                    {report.joinKeys.includes(f.id) ? <Badge tone="lime">key</Badge> : null}
                  </span>
                }
                hint={`${f.type} · e.g. ${f.sample}`}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. filters
// ---------------------------------------------------------------------------

let filterSeq = 0;

export function StepFilters({ state, dispatch, reports }: StepProps) {
  const columnOptions = state.columns
    .map((ref) => ({ ref, hit: findField(reports, ref) }))
    .filter((x): x is { ref: string; hit: NonNullable<typeof x.hit> } => Boolean(x.hit));

  const addFilter = () => {
    const first = columnOptions[0];
    if (!first) return;
    filterSeq += 1;
    const filter: SyncFilter = {
      id: `flt_${Date.now().toString(36)}${filterSeq}`,
      column: first.ref,
      op: "eq",
      value: "",
    };
    dispatch({ type: "addFilter", filter });
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <SectionLabel>Date range</SectionLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DATE_RANGE_OPTIONS.map((d) => (
            <Chip
              key={d.id}
              active={state.dateRange === d.id}
              onClick={() => dispatch({ type: "dateRange", value: d.id })}
            >
              {d.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink/50">
          Applied to each report's own date column, and re-evaluated on every
          refresh — {dateRangeLabel(state.dateRange).toLowerCase()} stays{" "}
          {dateRangeLabel(state.dateRange).toLowerCase()}.
        </p>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <SectionLabel>Field filters</SectionLabel>
          <span className="text-[11px] text-ink/40">{state.filters.length}</span>
        </div>
        <div className="mt-1.5 flex flex-col gap-2">
          {state.filters.map((f) => (
            <div key={f.id} className="rounded-xl border border-gray-200 p-2.5">
              <Select
                label="Column"
                value={f.column}
                onChange={(e) => dispatch({ type: "updateFilter", filter: { ...f, column: e.target.value } })}
              >
                {columnOptions.map((c) => (
                  <option key={c.ref} value={c.ref}>
                    {c.hit.field.name} — {c.hit.report.name}
                  </option>
                ))}
              </Select>
              <div className="mt-2 flex gap-2">
                <div className="w-[46%]">
                  <Select
                    label="Condition"
                    value={f.op}
                    onChange={(e) =>
                      dispatch({ type: "updateFilter", filter: { ...f, op: e.target.value as FilterOp } })
                    }
                  >
                    {FILTER_OPS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="min-w-0 flex-1">
                  <Input
                    label="Value"
                    value={f.value}
                    placeholder={findField(reports, f.column)?.field.sample ?? ""}
                    onChange={(e) => dispatch({ type: "updateFilter", filter: { ...f, value: e.target.value } })}
                  />
                </div>
              </div>
              <div className="mt-1.5 text-right">
                <button
                  className="rounded px-1.5 py-0.5 text-[11.5px] text-ink/40 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-forest/30"
                  onClick={() => dispatch({ type: "removeFilter", id: f.id })}
                >
                  Remove filter
                </button>
              </div>
            </div>
          ))}
          <Button variant="secondary" className="w-full" onClick={addFilter} disabled={columnOptions.length === 0}>
            + Filter
          </Button>
          {state.filters.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-ink/40">
              Optional. Filters run server-side, so the sheet only ever receives
              the rows you asked for.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. destination + schedule
// ---------------------------------------------------------------------------

export function StepDestination({ state, dispatch, usage, sheetTabs }: StepProps) {
  const isFree = usage?.plan !== "pro";

  return (
    <div className="flex flex-col gap-4">
      <section>
        <SectionLabel>Sync name</SectionLabel>
        <div className="mt-1.5">
          <Input
            value={state.name}
            placeholder="Profit by SKU"
            aria-label="Sync name"
            onChange={(e) => dispatch({ type: "name", value: e.target.value })}
          />
        </div>
      </section>

      <section>
        <SectionLabel>Destination tab</SectionLabel>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <Radio
            name="destination"
            checked={state.createNewSheet}
            onChange={() => dispatch({ type: "createNewSheet", value: true })}
            label="Create a new tab"
            hint="DragonSheets owns the whole tab — nothing of yours gets overwritten."
          />
          <Radio
            name="destination"
            checked={!state.createNewSheet}
            onChange={() => dispatch({ type: "createNewSheet", value: false })}
            label="Write into an existing tab"
            hint={
              sheetTabs.length > 0
                ? `${sheetTabs.length} tab${sheetTabs.length === 1 ? "" : "s"} in this spreadsheet`
                : "Existing tabs weren't readable — type the name instead."
            }
          />
        </div>
        <div className="mt-2">
          {state.createNewSheet || sheetTabs.length === 0 ? (
            <Input
              label="Tab name"
              value={state.sheetName}
              placeholder="P&L by SKU"
              onChange={(e) => dispatch({ type: "sheetName", value: e.target.value })}
            />
          ) : (
            <Select
              label="Tab"
              value={state.sheetName}
              onChange={(e) => dispatch({ type: "sheetName", value: e.target.value })}
            >
              <option value="">Choose a tab…</option>
              {sheetTabs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          )}
        </div>
      </section>

      <section>
        <SectionLabel>Refresh</SectionLabel>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {SCHEDULE_OPTIONS.map((s) => {
            const locked = s.requiresPro && isFree;
            return (
              <Radio
                key={s.id}
                name="schedule"
                checked={state.schedule === s.id}
                disabled={locked}
                onChange={() => dispatch({ type: "schedule", value: s.id })}
                label={s.label}
                hint={s.hint}
                trailing={locked ? <Badge>Pro</Badge> : null}
                className={locked ? "opacity-50" : ""}
              />
            );
          })}
        </div>
        {isFree ? (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink/50">
            Refresh faster than daily is on the Pro plan. Daily still runs on its
            own — you just won't see intraday moves.
          </p>
        ) : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. review
// ---------------------------------------------------------------------------

export function StepReview({ state, dispatch, reports, accounts }: StepProps) {
  const selectedAccounts = accounts.filter((a) => state.accountIds.includes(a.id));
  const columnsByReport = state.reportIds.map((rid) => ({
    report: findReport(reports, rid),
    count: state.columns.filter((c) => splitColumnRef(c).reportId === rid).length,
  }));

  return (
    <div className="flex flex-col gap-2.5">
      <ReviewRow
        label="Accounts"
        value={selectedAccounts.map((a) => a.name).join(", ") || "—"}
        onEdit={() => dispatch({ type: "step", step: "accounts" })}
      />
      <ReviewRow
        label="Marketplaces"
        value={state.marketplaceIds.join(", ") || "—"}
        onEdit={() => dispatch({ type: "step", step: "accounts" })}
      />
      <ReviewRow
        label="Reports"
        value={
          columnsByReport
            .map((c) => `${c.report?.name ?? "?"} (${c.count} cols)`)
            .join(", ") || "—"
        }
        onEdit={() => dispatch({ type: "step", step: "reports" })}
      />
      {state.reportIds.length > 1 ? (
        <ReviewRow
          label="Blend"
          value={`${findReport(reports, state.primaryReportId)?.name ?? "?"} joined on ${
            state.joinKeys.map((k) => joinKeyLabel(reports, k)).join(" + ") || "—"
          }`}
          onEdit={() => dispatch({ type: "step", step: "columns" })}
        />
      ) : null}
      <ReviewRow
        label="Columns"
        value={`${state.columns.length} selected${
          state.calculatedColumns.length > 0
            ? ` + ${state.calculatedColumns.length} calculated (${state.calculatedColumns
                .map((c) => c.name)
                .join(", ")})`
            : ""
        }`}
        onEdit={() => dispatch({ type: "step", step: "columns" })}
      />
      <ReviewRow
        label="Filters"
        value={`${dateRangeLabel(state.dateRange)}${
          state.filters.length > 0 ? ` · ${state.filters.length} field filter(s)` : ""
        }`}
        onEdit={() => dispatch({ type: "step", step: "filters" })}
      />
      <ReviewRow
        label="Destination"
        value={`${state.sheetName || "—"}${state.createNewSheet ? " (new tab)" : " (existing tab)"}`}
        onEdit={() => dispatch({ type: "step", step: "destination" })}
      />
      <ReviewRow
        label="Refresh"
        value={scheduleLabel(state.schedule)}
        onEdit={() => dispatch({ type: "step", step: "destination" })}
      />
      <PreviewPanel state={state} reports={reports} accounts={accounts} />
    </div>
  );
}

/**
 * `POST /v1/sheets/preview` — a handful of real rows before anything is
 * written. On demand, never on mount: it costs a BigQuery query, and review is
 * also where someone lands just to change the schedule.
 *
 * Hard-capped at 50 rows server-side. Emphatically not an export path
 * (docs/EXTENSION_API.md → "the extension is never in the data path").
 */
function PreviewPanel({
  state,
  reports,
  accounts,
}: Pick<StepProps, "state" | "reports" | "accounts">) {
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await getBackend().previewSync(toSyncConfig(state, reports, accounts), 10));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't load a preview.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>Preview</SectionLabel>
        <button
          className="rounded text-[11.5px] font-medium text-forest underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-forest/30"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Loading…" : preview ? "Refresh" : "Show 10 rows"}
        </button>
      </div>
      {error ? <p className="mt-1 text-[11.5px] leading-snug text-red-600">{error}</p> : null}
      {preview && preview.rows.length === 0 ? (
        <p className="mt-1 text-[11.5px] leading-snug text-ink/50">
          No rows match this configuration. Widen the date range or drop a
          filter — as it stands the sync would write an empty tab.
        </p>
      ) : null}
      {preview && preview.rows.length > 0 ? (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full border-collapse text-[10.5px]">
            <thead>
              <tr>
                {preview.columns.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap border-b border-gray-200 px-1 py-0.5 text-left font-semibold text-ink/50"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="whitespace-nowrap border-b border-gray-100 px-1 py-0.5 text-ink/70"
                    >
                      {cell === null ? "" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!preview && !error && !loading ? (
        <p className="mt-1 text-[11.5px] leading-snug text-ink/40">
          A sample of what this sync will write. Nothing reaches your sheet
          until you create it.
        </p>
      ) : null}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">{label}</span>
        <button
          className="rounded text-[11.5px] font-medium text-forest underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-forest/30"
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
      <div className="mt-0.5 break-words text-[12.5px] leading-snug text-ink">{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">{children}</span>
  );
}
