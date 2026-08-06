/**
 * The BackendClient interface — the single seam between the extension UI and
 * the (deferred) real backend at api.getdragonbot.com.
 *
 * Everything in the sidebar talks to this interface only. Phase 8 of
 * sellerconnect/DRAGONSHEETS_PLAN.md implements RealBackend against it; until
 * then MockBackend (./mock.ts) is the only implementation.
 */
import type { GoogleProfile } from "../lib/messages";

// ---------- auth ----------

export interface Session {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  createdAt: number;
}

// ---------- sheet access ----------

export interface SheetAccess {
  granted: boolean;
  checkedAt: number;
}

// ---------- Amazon connections ----------

export type ConnectProvider = "amazon-selling-partner" | "amazon-ads";

export type ConnectionState = "disconnected" | "pending" | "connected" | "error";

export interface ConnectionStatus {
  sellerCentral: { state: ConnectionState; accountName?: string; connectedAt?: number };
  ads: { state: ConnectionState; accountName?: string; connectedAt?: number };
}

/**
 * Result of starting a connect flow. `url` is opened in a popup window; the
 * popup reports back via a `dragonbot-oauth-result` postMessage (the same
 * contract the real backend's consent flow already implements — Phase 8 swaps
 * the mock URL for POST /v1/connect/amazon-selling-partner/start etc.).
 */
export interface ConnectStart {
  url: string;
  provider: ConnectProvider;
}

/**
 * A linked Amazon account, expanded per marketplace. The sync wizard's first
 * step picks account + marketplaces from this list (hopted's
 * `sync-external-accounts` step, teardown §6.1).
 */
export interface Marketplace {
  id: string;
  /** Two-letter country code, e.g. "US". */
  countryCode: string;
  name: string;
}

export interface AmazonAccount {
  id: string;
  provider: ConnectProvider;
  name: string;
  /** Seller/profile id as Amazon shows it — displayed for disambiguation. */
  externalId: string;
  marketplaces: Marketplace[];
}

// ---------- report catalog ----------

export type ReportSource = "seller-central" | "ads";

export type FieldType = "string" | "number" | "currency" | "percent" | "date" | "boolean";

export interface ReportField {
  /** Column id as it exists in BigQuery. */
  id: string;
  /** Human label — also the token name used in calculated-column formulas. */
  name: string;
  type: FieldType;
  /** Example value, used for column previews and formula preview evaluation. */
  sample: string;
}

export interface ReportCatalogEntry {
  id: string;
  name: string;
  source: ReportSource;
  description: string;
  fields: ReportField[];
  /**
   * Field ids this report can be blended on. Two reports can be joined into
   * one sheet when their joinKeys intersect (hopted models this as a primary
   * integration-table instance plus secondaries — teardown §6.1).
   */
  joinKeys: string[];
  /** Rough row count for the last 30 days — shown so users can size a sync. */
  rowEstimate: number;
}

// ---------- calculated columns ----------

/**
 * Conceptual mirror of hopted's property system (teardown §6.2), trimmed to
 * the three kinds that carry their weight:
 *  - formula   — spreadsheet-style expression over [Field Name] tokens
 *  - constant  — a fixed literal written into every row
 *  - virtual   — a column the sync reserves but never writes (user-owned)
 */
export type CalculatedColumnKind = "formula" | "constant" | "virtual";

export interface CalculatedColumn {
  id: string;
  name: string;
  kind: CalculatedColumnKind;
  /** Present when kind === "formula", e.g. "[Spend] / [Sales 14d]". */
  formula?: string;
  /** Present when kind === "constant". */
  constant?: string;
}

// ---------- syncs ----------

export type SyncSchedule = "15min" | "hourly" | "daily" | "weekly" | "manual";

export type SyncStatus = "idle" | "running" | "ok" | "error";

export type DateRangePreset = "last-7" | "last-30" | "last-90" | "ytd" | "all";

export type FilterOp = "eq" | "neq" | "contains" | "gt" | "lt";

export interface SyncFilter {
  id: string;
  /** Qualified column ref: `<reportId>:<fieldId>`. */
  column: string;
  op: FilterOp;
  value: string;
}

/** One report, scoped to an account + its marketplaces. */
export interface SyncSource {
  reportId: string;
  accountId: string;
  marketplaceIds: string[];
}

export interface SyncConfig {
  name: string;
  sources: SyncSource[];
  /** The report that drives row identity — hopted's "primary source". */
  primaryReportId: string;
  /** Field ids the sources are blended on (empty for a single-source sync). */
  joinKeys: string[];
  /** Selected columns, qualified as `<reportId>:<fieldId>`, in output order. */
  columns: string[];
  calculatedColumns: CalculatedColumn[];
  dateRange: DateRangePreset;
  filters: SyncFilter[];
  schedule: SyncSchedule;
  /** Target tab name within the current spreadsheet. */
  sheetName: string;
  /** True = create the tab, false = write into an existing tab. */
  createNewSheet: boolean;
}

export interface Sync extends SyncConfig {
  id: string;
  status: SyncStatus;
  paused: boolean;
  createdAt: number;
  lastRunAt?: number;
  rowCount: number;
}

export interface SyncRun {
  id: string;
  syncId: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "ok" | "error";
  rows: number;
  message?: string;
}

/** A partially-specified sync — what templates and agent proposals hand to the wizard. */
export type SyncDraft = Partial<SyncConfig>;

// ---------- AI agent ----------

export interface AgentProposal {
  id: string;
  title: string;
  summary: string;
  /** Bullet lines rendered in the review card. */
  details: string[];
  draft: SyncDraft;
  status: "pending" | "applied" | "discarded";
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: number;
  /** Present when the assistant turn produced a review-then-apply proposal. */
  proposal?: AgentProposal;
}

/**
 * MV3 service workers can't hold streaming responses, so the agent API uses
 * the 202-plus-continuation pattern (hopted-teardown §6.4): a send may return
 * `running` with a continuation token that the client polls until `complete`.
 */
export type AgentResult =
  | { status: "complete"; message: AgentMessage }
  | { status: "running"; continuationToken: string; expiresAt: number };

// ---------- templates ----------

export type TemplateCategory = "profitability" | "advertising" | "inventory" | "operations";

export interface Template {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  reportIds: string[];
  /** What the user gets — three short lines on the card back. */
  highlights: string[];
  /** Default tab name the template writes to. */
  sheetName: string;
}

// ---------- workspace / plan ----------

export interface WorkspaceMember {
  id: string;
  email: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  status: "active" | "invited";
}

export interface Usage {
  plan: "free" | "pro";
  syncsUsed: number;
  syncsLimit: number;
  accountsUsed: number;
  accountsLimit: number;
  /** Rows written this billing period — the meter hopted charges on. */
  rowsUsed: number;
  rowsLimit: number;
  periodResetsAt: number;
}

// ---------- the client ----------

export interface BackendClient {
  // auth
  getSession(): Promise<Session | null>;
  /**
   * Establish a session. In mock mode a fake profile is minted; in real mode
   * the Google profile obtained via chrome.identity is passed in (Phase 8:
   * exchanged server-side for an sc_* session token).
   */
  googleSignIn(profile?: GoogleProfile): Promise<Session>;
  signOut(): Promise<void>;

  // sheet access (service-account model — the extension holds NO Google scopes)
  getServiceAccountEmail(): Promise<string>;
  checkSheetAccess(spreadsheetId: string): Promise<SheetAccess>;

  // Amazon connections
  startSpApiConnect(): Promise<ConnectStart>;
  startAdsConnect(): Promise<ConnectStart>;
  getConnectionStatus(): Promise<ConnectionStatus>;
  /** Called when the consent popup posts a success result back. */
  completeConnect(provider: ConnectProvider): Promise<ConnectionStatus>;
  disconnect(provider: ConnectProvider): Promise<ConnectionStatus>;
  /** Connected accounts expanded per marketplace (wizard step 1). */
  listAccounts(): Promise<AmazonAccount[]>;

  // syncs
  listSyncs(): Promise<Sync[]>;
  getSync(id: string): Promise<Sync | null>;
  createSync(config: SyncConfig): Promise<Sync>;
  updateSync(id: string, patch: SyncDraft): Promise<Sync>;
  deleteSync(id: string): Promise<void>;
  setSyncPaused(id: string, paused: boolean): Promise<Sync>;
  runSync(id: string): Promise<SyncRun>;
  listSyncRuns(id: string): Promise<SyncRun[]>;

  // reports
  listReports(): Promise<ReportCatalogEntry[]>;

  // AI agent
  sendAgentMessage(content: string): Promise<AgentResult>;
  continueAgent(continuationToken: string): Promise<AgentResult>;
  cancelAgent(continuationToken: string): Promise<void>;
  getAgentHistory(): Promise<AgentMessage[]>;
  clearAgentHistory(): Promise<void>;
  getAgentProposal(id: string): Promise<AgentProposal | null>;
  resolveAgentProposal(id: string, status: "applied" | "discarded"): Promise<AgentProposal>;

  // templates
  listTemplates(): Promise<Template[]>;
  /** Turn a template into a prefilled sync draft for the wizard. */
  materializeTemplate(id: string): Promise<SyncDraft>;

  // workspace / plan
  listWorkspaceMembers(): Promise<WorkspaceMember[]>;
  getUsage(): Promise<Usage>;
}
