/**
 * Sync-wizard domain model: option tables, column-reference helpers and the
 * typed state machine behind the six-step wizard.
 *
 * The wizard mirrors hopted's pipeline flow (teardown §6.1) —
 * accounts → reports → fields → filters → destination/schedule → review —
 * with the state kept in one reducer so every step is a pure render of it and
 * "can I advance?" is a single function.
 */
import type {
  AmazonAccount,
  CalculatedColumn,
  DateRangePreset,
  FilterOp,
  ReportCatalogEntry,
  ReportField,
  SyncConfig,
  SyncDraft,
  SyncFilter,
  SyncSchedule,
  SyncSource,
} from "../../../backend/types";
import type { FormulaField } from "../../../lib/formula";

// ---------- option tables ----------

export const WIZARD_STEPS = [
  "accounts",
  "reports",
  "columns",
  "filters",
  "destination",
  "review",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_TITLE: Record<WizardStep, string> = {
  accounts: "Accounts & marketplaces",
  reports: "Reports",
  columns: "Columns",
  filters: "Filters",
  destination: "Destination & schedule",
  review: "Review",
};

export const SCHEDULE_OPTIONS: ReadonlyArray<{
  id: SyncSchedule;
  label: string;
  hint: string;
  /** Fast refresh is a paid axis, exactly as hopted gates `refresh.fast`. */
  requiresPro: boolean;
}> = [
  { id: "15min", label: "Every 15 minutes", hint: "For near-live ops dashboards", requiresPro: true },
  { id: "hourly", label: "Hourly", hint: "Good for ads monitoring", requiresPro: true },
  { id: "daily", label: "Daily", hint: "Runs after Amazon's overnight data lands", requiresPro: false },
  { id: "weekly", label: "Weekly", hint: "Monday mornings", requiresPro: false },
  { id: "manual", label: "Manual only", hint: "Runs when you click Run now", requiresPro: false },
];

export const DATE_RANGE_OPTIONS: ReadonlyArray<{ id: DateRangePreset; label: string }> = [
  { id: "last-7", label: "Last 7 days" },
  { id: "last-30", label: "Last 30 days" },
  { id: "last-90", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "all", label: "All available" },
];

export const FILTER_OPS: ReadonlyArray<{ id: FilterOp; label: string; numeric: boolean }> = [
  { id: "eq", label: "is", numeric: false },
  { id: "neq", label: "is not", numeric: false },
  { id: "contains", label: "contains", numeric: false },
  { id: "gt", label: "greater than", numeric: true },
  { id: "lt", label: "less than", numeric: true },
];

export function scheduleLabel(schedule: SyncSchedule): string {
  return SCHEDULE_OPTIONS.find((s) => s.id === schedule)?.label ?? schedule;
}

export function dateRangeLabel(range: DateRangePreset): string {
  return DATE_RANGE_OPTIONS.find((d) => d.id === range)?.label ?? range;
}

// ---------- column references (`<reportId>:<fieldId>`) ----------

export function columnRef(reportId: string, fieldId: string): string {
  return `${reportId}:${fieldId}`;
}

export function splitColumnRef(ref: string): { reportId: string; fieldId: string } {
  const idx = ref.indexOf(":");
  return idx === -1
    ? { reportId: "", fieldId: ref }
    : { reportId: ref.slice(0, idx), fieldId: ref.slice(idx + 1) };
}

export function findReport(
  reports: ReportCatalogEntry[],
  reportId: string
): ReportCatalogEntry | undefined {
  return reports.find((r) => r.id === reportId);
}

export function findField(
  reports: ReportCatalogEntry[],
  ref: string
): { report: ReportCatalogEntry; field: ReportField } | undefined {
  const { reportId, fieldId } = splitColumnRef(ref);
  const report = findReport(reports, reportId);
  const field = report?.fields.find((f) => f.id === fieldId);
  return report && field ? { report, field } : undefined;
}

export function columnLabel(reports: ReportCatalogEntry[], ref: string): string {
  return findField(reports, ref)?.field.name ?? splitColumnRef(ref).fieldId;
}

/** Join keys shared by every selected report — what a blend can key on. */
export function commonJoinKeys(reports: ReportCatalogEntry[], reportIds: string[]): string[] {
  const selected = reportIds
    .map((rid) => findReport(reports, rid))
    .filter((r): r is ReportCatalogEntry => Boolean(r));
  if (selected.length === 0) return [];
  return selected
    .map((r) => r.joinKeys)
    .reduce((acc, keys) => acc.filter((k) => keys.includes(k)));
}

/** Human name for a join key, taken from whichever report defines it. */
export function joinKeyLabel(reports: ReportCatalogEntry[], key: string): string {
  for (const r of reports) {
    const f = r.fields.find((x) => x.id === key);
    if (f) return f.name;
  }
  return key;
}

/**
 * Fields a formula may reference: every selected column, plus the calculated
 * columns defined before it. Deduped by name — two reports can both expose
 * "Spend" and the formula language only has one token for it.
 */
export function formulaFields(
  reports: ReportCatalogEntry[],
  columns: string[],
  calculated: CalculatedColumn[] = []
): FormulaField[] {
  const out: FormulaField[] = [];
  const seen = new Set<string>();
  for (const ref of columns) {
    const hit = findField(reports, ref);
    if (!hit) continue;
    const key = hit.field.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: hit.field.name, sample: hit.field.sample });
  }
  for (const c of calculated) {
    const key = c.name.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: c.name.trim(), sample: c.kind === "constant" ? c.constant ?? "0" : "0" });
  }
  return out;
}

// ---------- wizard state ----------

export interface WizardState {
  step: WizardStep;
  name: string;
  accountIds: string[];
  marketplaceIds: string[];
  reportIds: string[];
  primaryReportId: string;
  joinKeys: string[];
  columns: string[];
  calculatedColumns: CalculatedColumn[];
  dateRange: DateRangePreset;
  filters: SyncFilter[];
  schedule: SyncSchedule;
  sheetName: string;
  createNewSheet: boolean;
}

export const INITIAL_WIZARD: WizardState = {
  step: "accounts",
  name: "",
  accountIds: [],
  marketplaceIds: [],
  reportIds: [],
  primaryReportId: "",
  joinKeys: [],
  columns: [],
  calculatedColumns: [],
  dateRange: "last-30",
  filters: [],
  schedule: "daily",
  sheetName: "",
  createNewSheet: true,
};

export type WizardAction =
  | { type: "step"; step: WizardStep }
  | { type: "next" }
  | { type: "back" }
  | { type: "name"; value: string }
  | { type: "toggleAccount"; id: string; marketplaceIds: string[] }
  | { type: "toggleMarketplace"; id: string }
  | { type: "toggleReport"; report: ReportCatalogEntry; reports: ReportCatalogEntry[] }
  | { type: "primary"; reportId: string }
  | { type: "toggleJoinKey"; key: string }
  | { type: "toggleColumn"; ref: string }
  | { type: "setReportColumns"; reportId: string; refs: string[]; selected: boolean }
  | { type: "addCalculated"; column: CalculatedColumn }
  | { type: "updateCalculated"; column: CalculatedColumn }
  | { type: "removeCalculated"; id: string }
  | { type: "dateRange"; value: DateRangePreset }
  | { type: "addFilter"; filter: SyncFilter }
  | { type: "updateFilter"; filter: SyncFilter }
  | { type: "removeFilter"; id: string }
  | { type: "schedule"; value: SyncSchedule }
  | { type: "sheetName"; value: string }
  | { type: "createNewSheet"; value: boolean }
  | { type: "hydrate"; state: WizardState };

function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "step":
      return { ...state, step: action.step };
    case "next": {
      const next = WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, stepIndex(state.step) + 1)]!;
      return { ...state, step: next };
    }
    case "back": {
      const prev = WIZARD_STEPS[Math.max(0, stepIndex(state.step) - 1)]!;
      return { ...state, step: prev };
    }
    case "name":
      return { ...state, name: action.value };
    case "toggleAccount": {
      const accountIds = toggle(state.accountIds, action.id);
      // Selecting the first account seeds every marketplace it covers.
      const marketplaceIds =
        accountIds.length > 0 && state.marketplaceIds.length === 0
          ? action.marketplaceIds
          : state.marketplaceIds;
      return { ...state, accountIds, marketplaceIds };
    }
    case "toggleMarketplace":
      return { ...state, marketplaceIds: toggle(state.marketplaceIds, action.id) };
    case "toggleReport": {
      const reportIds = toggle(state.reportIds, action.report.id);
      const columns = state.columns.filter((ref) =>
        reportIds.includes(splitColumnRef(ref).reportId)
      );
      const primaryReportId = reportIds.includes(state.primaryReportId)
        ? state.primaryReportId
        : reportIds[0] ?? "";
      const available = commonJoinKeys(action.reports, reportIds);
      const joinKeys =
        reportIds.length > 1
          ? (() => {
              const kept = state.joinKeys.filter((k) => available.includes(k));
              return kept.length > 0 ? kept : available.slice(0, 1);
            })()
          : [];
      const filters = state.filters.filter((f) =>
        reportIds.includes(splitColumnRef(f.column).reportId)
      );
      // Newly added report: pre-select its join-key + first metric columns so
      // the columns step never opens empty.
      const added = reportIds.includes(action.report.id);
      const seeded = added
        ? action.report.fields
            .filter((f) => action.report.joinKeys.includes(f.id) || f.type !== "string")
            .slice(0, 6)
            .map((f) => columnRef(action.report.id, f.id))
        : [];
      const merged = [...columns, ...seeded.filter((r) => !columns.includes(r))];
      return { ...state, reportIds, primaryReportId, joinKeys, columns: merged, filters };
    }
    case "primary":
      return { ...state, primaryReportId: action.reportId };
    case "toggleJoinKey":
      return { ...state, joinKeys: toggle(state.joinKeys, action.key) };
    case "toggleColumn": {
      const columns = toggle(state.columns, action.ref);
      return {
        ...state,
        columns,
        filters: state.filters.filter((f) => columns.includes(f.column)),
      };
    }
    case "setReportColumns": {
      const columns = action.selected
        ? [...state.columns, ...action.refs.filter((r) => !state.columns.includes(r))]
        : state.columns.filter((r) => !action.refs.includes(r));
      return {
        ...state,
        columns,
        filters: state.filters.filter((f) => columns.includes(f.column)),
      };
    }
    case "addCalculated":
      return { ...state, calculatedColumns: [...state.calculatedColumns, action.column] };
    case "updateCalculated":
      return {
        ...state,
        calculatedColumns: state.calculatedColumns.map((c) =>
          c.id === action.column.id ? action.column : c
        ),
      };
    case "removeCalculated":
      return {
        ...state,
        calculatedColumns: state.calculatedColumns.filter((c) => c.id !== action.id),
      };
    case "dateRange":
      return { ...state, dateRange: action.value };
    case "addFilter":
      return { ...state, filters: [...state.filters, action.filter] };
    case "updateFilter":
      return {
        ...state,
        filters: state.filters.map((f) => (f.id === action.filter.id ? action.filter : f)),
      };
    case "removeFilter":
      return { ...state, filters: state.filters.filter((f) => f.id !== action.id) };
    case "schedule":
      return { ...state, schedule: action.value };
    case "sheetName":
      return { ...state, sheetName: action.value };
    case "createNewSheet":
      return { ...state, createNewSheet: action.value };
    case "hydrate":
      return action.state;
  }
}

/** Why the current step can't be completed yet — null when it can. */
export function stepBlocker(state: WizardState, reports: ReportCatalogEntry[]): string | null {
  switch (state.step) {
    case "accounts":
      if (state.accountIds.length === 0) return "Pick at least one Amazon account.";
      if (state.marketplaceIds.length === 0) return "Pick at least one marketplace.";
      return null;
    case "reports":
      if (state.reportIds.length === 0) return "Pick at least one report.";
      return null;
    case "columns": {
      if (state.columns.length === 0) return "Pick at least one column.";
      if (state.reportIds.length > 1) {
        if (commonJoinKeys(reports, state.reportIds).length === 0)
          return "These reports share no common key — swap one out.";
        if (state.joinKeys.length === 0)
          return "Pick a join key so the reports can be blended.";
      }
      if (state.calculatedColumns.some((c) => c.name.trim() === ""))
        return "Every calculated column needs a name.";
      return null;
    }
    case "filters":
      if (state.filters.some((f) => f.value.trim() === "")) return "Every filter needs a value.";
      return null;
    case "destination":
      if (state.sheetName.trim() === "") return "Name the destination tab.";
      if (state.name.trim() === "") return "Name this sync.";
      return null;
    case "review":
      return null;
  }
}

/** Derive the persisted config from wizard state. */
export function toSyncConfig(
  state: WizardState,
  reports: ReportCatalogEntry[],
  accounts: AmazonAccount[]
): SyncConfig {
  const sources: SyncSource[] = state.reportIds.map((reportId) => {
    const report = findReport(reports, reportId);
    const wantedProvider = report?.source === "ads" ? "amazon-ads" : "amazon-selling-partner";
    const account =
      accounts.find((a) => state.accountIds.includes(a.id) && a.provider === wantedProvider) ??
      accounts.find((a) => state.accountIds.includes(a.id));
    const marketplaceIds = account
      ? account.marketplaces
          .map((m) => m.id)
          .filter((m) => state.marketplaceIds.includes(m))
      : [];
    return { reportId, accountId: account?.id ?? "", marketplaceIds };
  });

  return {
    name: state.name.trim(),
    sources,
    primaryReportId: state.primaryReportId || state.reportIds[0] || "",
    joinKeys: state.reportIds.length > 1 ? state.joinKeys : [],
    columns: state.columns,
    calculatedColumns: state.calculatedColumns.map((c) => ({ ...c, name: c.name.trim() })),
    dateRange: state.dateRange,
    filters: state.filters,
    schedule: state.schedule,
    sheetName: state.sheetName.trim(),
    createNewSheet: state.createNewSheet,
  };
}

/**
 * Prefill the wizard from a template / agent-proposal draft. Anything the
 * draft doesn't specify keeps its default, and the accounts step is seeded
 * from whatever accounts the draft's sources named.
 */
export function hydrateFromDraft(
  draft: SyncDraft,
  accounts: AmazonAccount[],
  startStep: WizardStep = "accounts"
): WizardState {
  const sources = draft.sources ?? [];
  const accountIds = [...new Set(sources.map((s) => s.accountId).filter((x) => x !== ""))];
  const marketplaceIds = [...new Set(sources.flatMap((s) => s.marketplaceIds))];
  const fallbackMarkets =
    marketplaceIds.length > 0
      ? marketplaceIds
      : [...new Set(accounts.flatMap((a) => a.marketplaces.map((m) => m.id)))].slice(0, 1);
  return {
    ...INITIAL_WIZARD,
    step: startStep,
    name: draft.name ?? "",
    accountIds: accountIds.length > 0 ? accountIds : accounts.map((a) => a.id),
    marketplaceIds: fallbackMarkets,
    reportIds: sources.map((s) => s.reportId),
    primaryReportId: draft.primaryReportId ?? sources[0]?.reportId ?? "",
    joinKeys: draft.joinKeys ?? [],
    columns: draft.columns ?? [],
    calculatedColumns: draft.calculatedColumns ?? [],
    dateRange: draft.dateRange ?? INITIAL_WIZARD.dateRange,
    filters: draft.filters ?? [],
    schedule: draft.schedule ?? INITIAL_WIZARD.schedule,
    sheetName: draft.sheetName ?? "",
    createNewSheet: draft.createNewSheet ?? true,
  };
}

/** Wizard state from an existing sync — used by the per-sync editor. */
export function fromSyncConfig(config: SyncConfig, step: WizardStep = "columns"): WizardState {
  return {
    ...INITIAL_WIZARD,
    step,
    name: config.name,
    accountIds: [...new Set(config.sources.map((s) => s.accountId))],
    marketplaceIds: [...new Set(config.sources.flatMap((s) => s.marketplaceIds))],
    reportIds: config.sources.map((s) => s.reportId),
    primaryReportId: config.primaryReportId,
    joinKeys: config.joinKeys,
    columns: config.columns,
    calculatedColumns: config.calculatedColumns,
    dateRange: config.dateRange,
    filters: config.filters,
    schedule: config.schedule,
    sheetName: config.sheetName,
    createNewSheet: config.createNewSheet,
  };
}
