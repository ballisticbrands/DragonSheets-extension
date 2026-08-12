/**
 * Wire mapping for `/v1/sheets/*` — the translation layer between
 * sellerconnect's snake_case JSON and the extension's domain model.
 *
 * It lives in its own module, free of `chrome.*` and `fetch`, for one reason:
 * this is where the bugs are. The two models disagree on almost every axis —
 *
 *   backend                            extension
 *   ─────────────────────────────      ────────────────────────────────
 *   one entry per (report,connection)  one entry per report
 *   `columns: ["asin"]` per source     `columns: ["<reportId>:asin"]` flat
 *   filter column = bare name          filter column = "<reportId>:<field>"
 *   `date_range: {preset:"last_30_days"}`  `dateRange: "last-30"`
 *   `status: "active"|"paused"`        `paused: boolean`
 *   `kind: "formula"` only             formula | constant | virtual
 *
 * — so every one of these is a pure function the unit harness can drive
 * without a browser, a service worker or a network.
 *
 * The authority for the shapes is docs/EXTENSION_API.md, in particular its
 * "M3 implementation notes" section (filters, date presets, the calculated
 * column grammar and the error codes), plus sellerconnect
 * `src/routes/sheets.ts` and `src/services/sheets/catalog.ts`.
 */
import type {
  CalculatedColumn,
  DateRangePreset,
  FieldType,
  FilterOp,
  ReportCatalogEntry,
  ReportField,
  ReportSource,
  Sync,
  SyncConfig,
  SyncDraft,
  SyncFilter,
  SyncRun,
  SyncSchedule,
  SyncStatus,
} from "./types";

// ─── wire shapes ───────────────────────────────────────────────────────────

export interface WireCatalogColumn {
  name: string;
  label: string;
  type: string;
}

export interface WireCatalogEntry {
  id: string;
  label: string;
  source: "spapi" | "ads";
  connection_id: string;
  connection_name: string;
  date_column: string | null;
  row_estimate: number | null;
  join_keys: string[];
  columns: WireCatalogColumn[];
}

export interface WireSource {
  report_id: string;
  connection_id?: string;
  columns: string[];
}

export type WireFilterValue = string | number | boolean | null | Array<string | number>;

export interface WireFilter {
  column: string;
  op: string;
  value: WireFilterValue;
}

export interface WireCalculatedColumn {
  name: string;
  kind: "formula";
  expression: string;
}

export interface WireDateRange {
  preset?: string;
  start?: string;
  end?: string;
}

export interface WireSync {
  id: string;
  name: string;
  spreadsheet_id: string;
  tab_name: string;
  sources: WireSource[];
  primary_report_id: string;
  join_keys: string[];
  calculated_columns: WireCalculatedColumn[];
  filters: WireFilter[];
  date_range: WireDateRange;
  schedule: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  last_run: { at: string; status: string; rows: number } | null;
}

export interface WireRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows: number;
  error?: string;
}

export interface WireAccess {
  has_access: boolean;
  service_account_email: string | null;
  reason?: string;
  title?: string;
  tabs?: string[];
}

/** Thrown when a config the wizard produced cannot be expressed on the wire. */
export class UnsupportedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedConfigError";
  }
}

// ─── column references ─────────────────────────────────────────────────────

export function qualify(reportId: string, column: string): string {
  return `${reportId}:${column}`;
}

export function unqualify(ref: string): { reportId: string; column: string } {
  const idx = ref.indexOf(":");
  return idx === -1
    ? { reportId: "", column: ref }
    : { reportId: ref.slice(0, idx), column: ref.slice(idx + 1) };
}

// ─── catalog ───────────────────────────────────────────────────────────────

/**
 * BigQuery / SP-API column types → the six the UI knows how to format.
 * Unknown types become "string": rendering a number as text is a cosmetic
 * miss, formatting text as a number is a wrong answer.
 */
export function toFieldType(bqType: string | undefined): FieldType {
  const t = (bqType ?? "").toUpperCase();
  if (/BOOL/.test(t)) return "boolean";
  if (/^(DATE|DATETIME|TIMESTAMP|TIME)$/.test(t)) return "date";
  if (/INT|FLOAT|NUMERIC|DECIMAL|DOUBLE/.test(t)) return "number";
  return "string";
}

/**
 * The catalog carries no example values, and the formula editor needs one to
 * render its live preview. A type-shaped placeholder is honest (it is
 * obviously not real data) where a made-up ASIN would not be.
 */
function placeholderSample(type: FieldType): string {
  switch (type) {
    case "number":
    case "currency":
    case "percent":
      return "0";
    case "boolean":
      return "false";
    case "date":
      return new Date().toISOString().slice(0, 10);
    default:
      return "—";
  }
}

function toReportSource(source: WireCatalogEntry["source"]): ReportSource {
  return source === "ads" ? "ads" : "seller-central";
}

/**
 * Collapse the backend's one-entry-per-(report, connection) catalog into the
 * extension's one-entry-per-report model.
 *
 * The wizard picks an *account* in step 1 and a *report* in step 2, then pairs
 * them by provider (`toSyncConfig` in app/routes/syncs/model.ts) — so the
 * connection id belongs on the source, not on the catalog entry. Row estimates
 * are summed across connections because that is what the sync will actually
 * write when several accounts are selected.
 */
export function toCatalogEntries(wire: WireCatalogEntry[]): ReportCatalogEntry[] {
  const byId = new Map<string, ReportCatalogEntry>();
  const connectionNames = new Map<string, Set<string>>();

  for (const entry of wire) {
    if (!entry || typeof entry.id !== "string" || entry.id === "") continue;
    const fields: ReportField[] = (entry.columns ?? []).map((c) => {
      const type = toFieldType(c.type);
      return {
        id: c.name,
        name: c.label || c.name,
        type,
        sample: placeholderSample(type),
      };
    });

    const existing = byId.get(entry.id);
    const names = connectionNames.get(entry.id) ?? new Set<string>();
    if (entry.connection_name) names.add(entry.connection_name);
    connectionNames.set(entry.id, names);

    if (!existing) {
      byId.set(entry.id, {
        id: entry.id,
        name: entry.label || entry.id,
        source: toReportSource(entry.source),
        description: "",
        fields,
        joinKeys: entry.join_keys ?? [],
        rowEstimate: entry.row_estimate ?? 0,
      });
      continue;
    }
    // Same report on a second connection: add its rows, union its columns.
    existing.rowEstimate += entry.row_estimate ?? 0;
    const seen = new Set(existing.fields.map((f) => f.id));
    for (const f of fields) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        existing.fields.push(f);
      }
    }
  }

  for (const [id, report] of byId) {
    const names = [...(connectionNames.get(id) ?? [])].filter(Boolean);
    const provider = report.source === "ads" ? "Amazon Ads" : "Seller Central";
    report.description =
      names.length > 0 ? `${provider} · ${names.join(", ")}` : `${provider} report`;
  }

  return [...byId.values()];
}

// ─── date ranges ───────────────────────────────────────────────────────────

/** docs/EXTENSION_API.md → "Date range". `last_N_days` includes today. */
const PRESET_OUT: Record<DateRangePreset, string> = {
  "last-7": "last_7_days",
  "last-30": "last_30_days",
  "last-90": "last_90_days",
  ytd: "year_to_date",
  all: "all_time",
};

/**
 * Every backend preset mapped onto the five the wizard offers. The extra ones
 * (today, last_14_days, month_to_date, …) can only arrive from another client
 * or a hand-edited sync; they collapse onto the nearest range the UI can draw
 * rather than being silently dropped.
 */
const PRESET_IN: Record<string, DateRangePreset> = {
  today: "last-7",
  yesterday: "last-7",
  last_7_days: "last-7",
  last_14_days: "last-30",
  last_30_days: "last-30",
  last_60_days: "last-90",
  last_90_days: "last-90",
  month_to_date: "last-30",
  year_to_date: "ytd",
  all_time: "all",
};

export function toWireDateRange(preset: DateRangePreset): WireDateRange {
  return { preset: PRESET_OUT[preset] ?? "last_30_days" };
}

export function fromWireDateRange(range: WireDateRange | null | undefined): DateRangePreset {
  const preset = range?.preset;
  if (typeof preset === "string" && PRESET_IN[preset]) return PRESET_IN[preset]!;
  // An explicit start/end window has no representation in the wizard's five
  // presets. "all" is the only choice that cannot silently NARROW what the
  // user already had.
  if (range?.start || range?.end) return "all";
  return "last-30";
}

// ─── filters ───────────────────────────────────────────────────────────────

/** The five ops the UI offers are all in the backend's set; assert it here. */
const FILTER_OPS_OUT: Record<FilterOp, string> = {
  eq: "eq",
  neq: "neq",
  contains: "contains",
  gt: "gt",
  lt: "lt",
};

const FILTER_OPS_IN: Record<string, FilterOp> = {
  eq: "eq",
  neq: "neq",
  contains: "contains",
  gt: "gt",
  gte: "gt",
  lt: "lt",
  lte: "lt",
  in: "eq",
};

/**
 * `gt`/`lt` are numeric comparisons server-side; sending "12" as a string
 * would compare lexically. Everything else stays a string — an ASIN that
 * happens to be all digits must not become a number.
 */
function filterValue(op: FilterOp, raw: string): WireFilterValue {
  if (op === "gt" || op === "lt") {
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) return n;
  }
  return raw;
}

export function toWireFilters(filters: SyncFilter[]): WireFilter[] {
  return filters.map((f) => ({
    // The backend routes a filter to whichever source owns the column, so it
    // wants the BARE name — the "<reportId>:" prefix is ours alone.
    column: unqualify(f.column).column,
    op: FILTER_OPS_OUT[f.op] ?? "eq",
    value: filterValue(f.op, f.value),
  }));
}

/**
 * Re-qualify a bare filter column against the sync's own sources, so the UI's
 * "drop filters whose column is no longer selected" rule keeps working.
 */
export function fromWireFilters(filters: WireFilter[], sources: WireSource[]): SyncFilter[] {
  return (filters ?? []).map((f, i) => {
    const owner = sources.find((s) => (s.columns ?? []).includes(f.column));
    const reportId = owner?.report_id ?? sources[0]?.report_id ?? "";
    return {
      id: `flt_${i}`,
      column: reportId ? qualify(reportId, f.column) : f.column,
      op: FILTER_OPS_IN[f.op] ?? "eq",
      value: Array.isArray(f.value) ? f.value.join(", ") : f.value === null ? "" : String(f.value),
    };
  });
}

// ─── calculated columns ────────────────────────────────────────────────────

/**
 * `kind` is `"formula"` only on the wire, and expressions are evaluated
 * server-side per row.
 *
 * A `constant` whose value is numeric IS expressible (a literal expression),
 * so it is converted rather than refused. A non-numeric constant and a
 * `virtual` column are not — and are refused loudly at save time instead of
 * being dropped, because a column the user configured and then never sees is
 * the kind of silent loss that costs a support ticket.
 */
export function toWireCalculatedColumns(columns: CalculatedColumn[]): WireCalculatedColumn[] {
  const out: WireCalculatedColumn[] = [];
  for (const c of columns) {
    const name = c.name.trim();
    if (name === "") continue;
    if (c.kind === "formula") {
      out.push({ name, kind: "formula", expression: (c.formula ?? "").trim() });
      continue;
    }
    if (c.kind === "constant") {
      const raw = (c.constant ?? "").trim();
      if (raw !== "" && Number.isFinite(Number(raw))) {
        out.push({ name, kind: "formula", expression: raw });
        continue;
      }
      throw new UnsupportedConfigError(
        `The constant column “${name}” has to be a number — text constants aren't supported yet.`
      );
    }
    throw new UnsupportedConfigError(
      `The reserved column “${name}” isn't supported yet. Remove it, or make it a formula.`
    );
  }
  return out;
}

export function fromWireCalculatedColumns(columns: WireCalculatedColumn[]): CalculatedColumn[] {
  return (columns ?? []).map((c, i) => ({
    // Deterministic so a re-read doesn't remount every row in the editor.
    id: `cc_${i}`,
    name: c.name,
    kind: "formula",
    formula: c.expression,
  }));
}

// ─── schedule / status ─────────────────────────────────────────────────────

const SCHEDULES: readonly SyncSchedule[] = ["manual", "15min", "hourly", "daily", "weekly"];

export function toSchedule(raw: string | undefined): SyncSchedule {
  return (SCHEDULES as readonly string[]).includes(raw ?? "")
    ? (raw as SyncSchedule)
    : "daily";
}

function toSyncStatus(lastRun: WireSync["last_run"]): SyncStatus {
  switch (lastRun?.status) {
    case "ok":
      return "ok";
    case "error":
      return "error";
    case "running":
      return "running";
    default:
      return "idle";
  }
}

function msOr(value: string | null | undefined, fallback: number): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : fallback;
}

// ─── sync config ───────────────────────────────────────────────────────────

/**
 * The extension keeps selected columns in one flat, qualified list; the wire
 * wants them grouped under the source that owns them. A source with no
 * selected columns is dropped — the backend rejects an empty `columns` array,
 * and a report nobody took a column from contributes nothing anyway.
 */
export function toWireSources(config: Pick<SyncConfig, "sources" | "columns">): WireSource[] {
  const out: WireSource[] = [];
  for (const source of config.sources) {
    const columns = config.columns
      .map(unqualify)
      .filter((c) => c.reportId === source.reportId)
      .map((c) => c.column);
    if (columns.length === 0) continue;
    out.push({
      report_id: source.reportId,
      // Optional on the wire: omitted, the backend resolves it and 400s with
      // `invalid_source` only if the report is ambiguous across connections.
      ...(source.accountId ? { connection_id: source.accountId } : {}),
      columns,
    });
  }
  return out;
}

/**
 * SyncConfig → `POST /v1/sheets/syncs` body.
 *
 * NOTE: `marketplaceIds` has no wire equivalent — the backend scopes a source
 * by connection, not by marketplace. It is kept in the local model because the
 * wizard's step 1 uses it, but it does not travel. Same for `createNewSheet`:
 * the writer creates the tab when it is missing, so the flag is advisory.
 */
export function toWireSyncBody(
  config: SyncConfig,
  spreadsheetId: string
): Record<string, unknown> {
  return {
    name: config.name,
    spreadsheet_id: spreadsheetId,
    tab_name: config.sheetName,
    sources: toWireSources(config),
    primary_report_id: config.primaryReportId || config.sources[0]?.reportId || "",
    join_keys: config.joinKeys,
    calculated_columns: toWireCalculatedColumns(config.calculatedColumns),
    filters: toWireFilters(config.filters),
    date_range: toWireDateRange(config.dateRange),
    schedule: config.schedule,
  };
}

/**
 * SyncDraft → `PATCH /v1/sheets/syncs/:id` body.
 *
 * Only keys the caller actually set are emitted. The backend validates the
 * MERGED config, so a one-field patch is safe — but an explicit `undefined`
 * would fail schema validation with `invalid_request`, and sending a key the
 * caller never touched risks clobbering it with a default.
 *
 * `sources` and `columns` only travel together: the wire groups columns under
 * their source, so one without the other cannot be expressed.
 */
export function toWireSyncPatch(patch: SyncDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.sheetName !== undefined) body.tab_name = patch.sheetName;
  if (patch.sources !== undefined && patch.columns !== undefined) {
    body.sources = toWireSources({ sources: patch.sources, columns: patch.columns });
    body.primary_report_id = patch.primaryReportId || patch.sources[0]?.reportId || "";
    body.join_keys = patch.joinKeys ?? [];
  }
  if (patch.calculatedColumns !== undefined) {
    body.calculated_columns = toWireCalculatedColumns(patch.calculatedColumns);
  }
  if (patch.filters !== undefined) body.filters = toWireFilters(patch.filters);
  if (patch.dateRange !== undefined) body.date_range = toWireDateRange(patch.dateRange);
  if (patch.schedule !== undefined) body.schedule = patch.schedule;
  return body;
}

/** `POST /v1/sheets/preview` body — the same shape minus the destination. */
export function toWirePreviewBody(
  config: Pick<
    SyncConfig,
    "sources" | "columns" | "primaryReportId" | "joinKeys" | "calculatedColumns" | "filters" | "dateRange"
  >,
  limit?: number
): Record<string, unknown> {
  return {
    sources: toWireSources(config),
    primary_report_id: config.primaryReportId || config.sources[0]?.reportId || "",
    join_keys: config.joinKeys,
    calculated_columns: toWireCalculatedColumns(config.calculatedColumns),
    filters: toWireFilters(config.filters),
    date_range: toWireDateRange(config.dateRange),
    ...(limit === undefined ? {} : { limit: Math.max(1, Math.min(50, Math.round(limit))) }),
  };
}

export function fromWireSync(wire: WireSync): Sync {
  const sources = Array.isArray(wire.sources) ? wire.sources : [];
  return {
    id: wire.id,
    name: wire.name,
    sources: sources.map((s) => ({
      reportId: s.report_id,
      accountId: s.connection_id ?? "",
      // Not carried on the wire; the wizard re-derives it from the account.
      marketplaceIds: [],
    })),
    primaryReportId: wire.primary_report_id,
    joinKeys: wire.join_keys ?? [],
    columns: sources.flatMap((s) => (s.columns ?? []).map((c) => qualify(s.report_id, c))),
    calculatedColumns: fromWireCalculatedColumns(wire.calculated_columns),
    dateRange: fromWireDateRange(wire.date_range),
    filters: fromWireFilters(wire.filters ?? [], sources),
    schedule: toSchedule(wire.schedule),
    sheetName: wire.tab_name,
    // The tab exists by the time we read a sync back, so "create it" is done.
    createNewSheet: false,
    status: toSyncStatus(wire.last_run),
    paused: wire.status === "paused",
    createdAt: msOr(wire.created_at, Date.now()),
    ...(wire.last_run ? { lastRunAt: msOr(wire.last_run.at, Date.now()) } : {}),
    rowCount: wire.last_run?.rows ?? 0,
  };
}

export function fromWireRun(wire: WireRun, syncId: string): SyncRun {
  const status: SyncRun["status"] =
    wire.status === "ok" ? "ok" : wire.status === "error" ? "error" : "running";
  return {
    id: wire.id,
    syncId,
    startedAt: msOr(wire.started_at, Date.now()),
    ...(wire.finished_at ? { finishedAt: msOr(wire.finished_at, Date.now()) } : {}),
    status,
    rows: wire.rows ?? 0,
    ...(wire.error ? { message: wire.error } : {}),
  };
}
