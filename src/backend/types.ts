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

// ---------- syncs ----------

export type SyncSchedule = "15min" | "hourly" | "daily" | "weekly";

export type SyncStatus = "idle" | "running" | "ok" | "error";

export interface SyncConfig {
  name: string;
  reportId: string;
  columns: string[];
  schedule: SyncSchedule;
  /** Target sheet within the current spreadsheet ("" = new sheet). */
  sheetName: string;
}

export interface Sync extends SyncConfig {
  id: string;
  status: SyncStatus;
  createdAt: number;
  lastRunAt?: number;
}

// ---------- report catalog ----------

export type ReportSource = "seller-central" | "ads";

export interface ReportCatalogEntry {
  id: string;
  name: string;
  source: ReportSource;
  description: string;
  columns: string[];
}

// ---------- AI agent ----------

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
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

export interface Template {
  id: string;
  name: string;
  description: string;
  reportIds: string[];
}

// ---------- usage / plan ----------

export interface Usage {
  plan: "free" | "pro";
  syncsUsed: number;
  syncsLimit: number;
  accountsUsed: number;
  accountsLimit: number;
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

  // syncs
  listSyncs(): Promise<Sync[]>;
  createSync(config: SyncConfig): Promise<Sync>;
  runSync(id: string): Promise<Sync>;

  // reports
  listReports(): Promise<ReportCatalogEntry[]>;

  // AI agent
  sendAgentMessage(content: string): Promise<AgentResult>;
  continueAgent(continuationToken: string): Promise<AgentResult>;
  getAgentHistory(): Promise<AgentMessage[]>;

  // templates
  listTemplates(): Promise<Template[]>;

  // usage / plan
  getUsage(): Promise<Usage>;
}
