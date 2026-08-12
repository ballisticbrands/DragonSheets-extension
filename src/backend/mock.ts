/**
 * MockBackend — realistic-latency, chrome.storage.local-persisted fake
 * implementation of BackendClient. The entire product surface runs against
 * this until Phase 8 lands the real backend.
 *
 * Nothing here touches the network. Every method jitters its latency so the
 * loading, running and error states in the UI are actually reachable.
 */
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from "../lib/storage";
import type { GoogleProfile } from "../lib/messages";
import { REPORT_CATALOG, TEMPLATES } from "./catalog";
import type {
  AgentMessage,
  AgentProposal,
  AgentResult,
  AmazonAccount,
  BackendClient,
  CalculatedColumn,
  ConnectProvider,
  ConnectStart,
  ConnectionState,
  ConnectionStatus,
  DateRangePreset,
  Marketplace,
  ReportCatalogEntry,
  Session,
  SheetAccess,
  Sync,
  SyncConfig,
  SyncDraft,
  SyncPreview,
  SyncRun,
  SyncSource,
  Template,
  Usage,
  WorkspaceMember,
} from "./types";

// TODO(user-task): create the real GCP service account for the Sheets writer
// (Phase 8.2) and replace this placeholder address everywhere it appears.
export const SERVICE_ACCOUNT_EMAIL =
  "dragonsheets@dragonbot-487712.iam.gserviceaccount.com";

interface MockState {
  session: Session | null;
  /** spreadsheetId → access granted */
  sheetAccess: Record<string, boolean>;
  /**
   * A LIST, mirroring the real backend's /v1/connections — not the two-slot
   * ConnectionStatus it used to be. Storing the summary shape made the mock
   * incapable of ever holding a third account, which is exactly the situation
   * the Settings → Accounts bug needed reproducing.
   */
  connections: MockConnection[];
  /**
   * Whether the demo connections have been minted for this identity. Distinct
   * from `connections.length > 0` so that disconnecting every account STAYS
   * empty across reloads instead of silently re-seeding.
   */
  connectionsSeeded: boolean;
  syncs: Sync[];
  runs: SyncRun[];
  agentHistory: AgentMessage[];
  proposals: AgentProposal[];
}

/** The mock's stand-in for one row of the real backend's /v1/connections. */
interface MockConnection {
  id: string;
  provider: ConnectProvider;
  name: string;
  externalId: string;
  state: ConnectionState;
  connectedAt?: number;
  error?: string;
  marketplaceIds: string[];
}

const EMPTY_STATE: MockState = {
  session: null,
  sheetAccess: {},
  connections: [],
  connectionsSeeded: false,
  syncs: [],
  runs: [],
  agentHistory: [],
  proposals: [],
};

/** Realistic latency: base ± jitter, so loading states are actually visible. */
function delay(baseMs: number): Promise<void> {
  const ms = baseMs + Math.random() * baseMs * 0.5;
  return new Promise((r) => setTimeout(r, ms));
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Qualified column reference used everywhere in SyncConfig.columns. */
function col(reportId: string, fieldId: string): string {
  return `${reportId}:${fieldId}`;
}

const MARKETPLACES: Marketplace[] = [
  { id: "US", countryCode: "US", name: "United States (amazon.com)" },
  { id: "CA", countryCode: "CA", name: "Canada (amazon.ca)" },
  { id: "MX", countryCode: "MX", name: "Mexico (amazon.com.mx)" },
  { id: "UK", countryCode: "UK", name: "United Kingdom (amazon.co.uk)" },
  { id: "DE", countryCode: "DE", name: "Germany (amazon.de)" },
];

const DAY_MS = 86_400_000;

/**
 * The demo seller's connections, minted at sign-in.
 *
 * Shaped deliberately, because this fixture IS the regression guard for the
 * Settings → Accounts bug:
 *
 *  · FOUR connections, so anything that collapses per provider (the old
 *    two-card Accounts tab) is visibly wrong rather than plausibly right;
 *  · TWO of them Seller Central, which is the case that vanished;
 *  · one in "error", so the "an expired connection must still be reachable to
 *    reconnect" path is on screen in every demo and screenshot;
 *  · every `connectedAt` well past the analytics 7-day activation window, so
 *    seeding the demo cannot fire conversion events for accounts nobody just
 *    connected.
 */
function seedConnections(now: number): MockConnection[] {
  return [
    {
      id: "conn_sp_us",
      provider: "amazon-selling-partner",
      name: "Ballistic Brands (US)",
      externalId: "A2VQ8KDL91NRT4",
      state: "connected",
      connectedAt: now - 45 * DAY_MS,
      marketplaceIds: ["US", "CA", "MX"],
    },
    {
      id: "conn_sp_eu",
      provider: "amazon-selling-partner",
      name: "Ballistic Brands EU",
      externalId: "A1XKPQ73MZ0E9V",
      state: "connected",
      connectedAt: now - 31 * DAY_MS,
      marketplaceIds: ["UK", "DE"],
    },
    {
      id: "conn_ads_us",
      provider: "amazon-ads",
      name: "Ballistic Brands Ads",
      externalId: "3948571029384",
      state: "connected",
      connectedAt: now - 45 * DAY_MS,
      marketplaceIds: ["US", "CA"],
    },
    {
      id: "conn_ads_eu",
      provider: "amazon-ads",
      name: "Ballistic Brands Ads (EU)",
      externalId: "8827361094552",
      state: "error",
      connectedAt: now - 22 * DAY_MS,
      error: "Amazon revoked this authorisation. Reconnect to resume pulling Ads data.",
      marketplaceIds: ["UK", "DE"],
    },
  ];
}

/** Rank used to collapse many connections into the two-slot summary. */
const STATE_RANK: Record<ConnectionState, number> = {
  connected: 3,
  pending: 2,
  error: 1,
  disconnected: 0,
};

function toAccount(c: MockConnection): AmazonAccount {
  const account: AmazonAccount = {
    id: c.id,
    provider: c.provider,
    name: c.name,
    externalId: c.externalId,
    marketplaces: MARKETPLACES.filter((m) => c.marketplaceIds.includes(m.id)),
    state: c.state,
  };
  if (c.connectedAt !== undefined) account.connectedAt = c.connectedAt;
  if (c.error) account.error = c.error;
  return account;
}

/** Same collapse rule as RealBackend.getConnectionStatus — healthiest wins. */
function summarize(connections: MockConnection[]): ConnectionStatus {
  const status: ConnectionStatus = {
    sellerCentral: { state: "disconnected" },
    ads: { state: "disconnected" },
  };
  for (const c of connections) {
    const slot = c.provider === "amazon-ads" ? status.ads : status.sellerCentral;
    if (STATE_RANK[c.state] <= STATE_RANK[slot.state] && slot.state !== "disconnected") continue;
    slot.state = c.state;
    slot.accountName = c.name;
    if (c.connectedAt !== undefined) slot.connectedAt = c.connectedAt;
    else delete slot.connectedAt;
  }
  return status;
}

const DATE_RANGE_FACTOR: Record<DateRangePreset, number> = {
  "last-7": 0.25,
  "last-30": 1,
  "last-90": 2.6,
  ytd: 6,
  all: 9.5,
};

const WORKSPACE_MEMBERS: WorkspaceMember[] = [
  { id: "wm_owner", email: "info@getdragonsheets.com", name: "You", role: "owner", status: "active" },
];

function reportById(reportId: string): ReportCatalogEntry | undefined {
  return REPORT_CATALOG.find((r) => r.id === reportId);
}

/** Estimated rows a sync writes — sum of source estimates, date-range scaled. */
function estimateRows(config: Pick<SyncConfig, "sources" | "dateRange">): number {
  const base = config.sources.reduce((sum, s) => sum + (reportById(s.reportId)?.rowEstimate ?? 500), 0);
  const scaled = base * (DATE_RANGE_FACTOR[config.dateRange] ?? 1);
  // Blended syncs collapse to the primary source's grain, so don't just add.
  const collapsed = config.sources.length > 1 ? scaled / config.sources.length : scaled;
  return Math.max(12, Math.round(collapsed * (0.85 + Math.random() * 0.3)));
}

function calc(name: string, formula: string): CalculatedColumn {
  return { id: id("cc"), name, kind: "formula", formula };
}

// ---------------------------------------------------------------------------
// Template → sync draft materialisation (hopted: POST /SolutionTemplate/usePredefined)
// ---------------------------------------------------------------------------

const TEMPLATE_DRAFTS: Record<string, Omit<SyncDraft, "sources" | "name">> = {
  "tpl-pnl-sku": {
    primaryReportId: "sc-sales-traffic-asin",
    joinKeys: ["asin"],
    columns: [
      col("sc-sales-traffic-asin", "date"),
      col("sc-sales-traffic-asin", "asin"),
      col("sc-sales-traffic-asin", "units_ordered"),
      col("sc-sales-traffic-asin", "ordered_product_sales"),
      col("sc-fees", "sku"),
      col("sc-fees", "referral_fee"),
      col("sc-fees", "fba_fee"),
      col("ads-sp-advertised-product", "spend"),
      col("ads-sp-advertised-product", "sales_14d"),
    ],
    calculatedColumns: [
      calc("Net margin %", "([Ordered Product Sales] - [Referral Fee] - [FBA Fee] - [Spend]) / [Ordered Product Sales] * 100"),
    ],
    dateRange: "last-30",
    schedule: "daily",
    sheetName: "P&L by SKU",
    createNewSheet: true,
  },
  "tpl-tacos": {
    primaryReportId: "sc-sales-traffic-asin",
    joinKeys: ["date"],
    columns: [
      col("sc-sales-traffic-asin", "date"),
      col("sc-sales-traffic-asin", "ordered_product_sales"),
      col("sc-sales-traffic-asin", "units_ordered"),
      col("ads-sp-campaigns", "spend"),
      col("ads-sp-campaigns", "sales_14d"),
    ],
    calculatedColumns: [calc("TACOS %", "[Spend] / [Ordered Product Sales] * 100")],
    dateRange: "last-90",
    schedule: "daily",
    sheetName: "TACOS",
    createNewSheet: true,
  },
  "tpl-restock": {
    primaryReportId: "sc-fba-inventory",
    joinKeys: ["sku"],
    columns: [
      col("sc-fba-inventory", "sku"),
      col("sc-fba-inventory", "asin"),
      col("sc-fba-inventory", "fulfillable_qty"),
      col("sc-fba-inventory", "inbound_qty"),
      col("sc-orders", "quantity"),
    ],
    calculatedColumns: [calc("Days of cover", "[Fulfillable Qty] / ([Order Quantity] / 30)")],
    dateRange: "last-30",
    schedule: "daily",
    sheetName: "Restock",
    createNewSheet: true,
  },
  "tpl-search-terms": {
    primaryReportId: "ads-sp-search-terms",
    joinKeys: [],
    columns: [
      col("ads-sp-search-terms", "date"),
      col("ads-sp-search-terms", "campaign"),
      col("ads-sp-search-terms", "search_term"),
      col("ads-sp-search-terms", "clicks"),
      col("ads-sp-search-terms", "spend"),
      col("ads-sp-search-terms", "sales_14d"),
    ],
    calculatedColumns: [calc("ACOS %", "[Spend] / [Sales 14d] * 100")],
    dateRange: "last-30",
    schedule: "daily",
    sheetName: "Search Terms",
    createNewSheet: true,
  },
  "tpl-returns": {
    primaryReportId: "sc-returns",
    joinKeys: ["sku"],
    columns: [
      col("sc-returns", "return_date"),
      col("sc-returns", "sku"),
      col("sc-returns", "quantity"),
      col("sc-returns", "reason"),
      col("sc-returns", "disposition"),
      col("sc-orders", "quantity"),
    ],
    calculatedColumns: [calc("Return rate %", "[Returned Quantity] / [Order Quantity] * 100")],
    dateRange: "last-90",
    schedule: "daily",
    sheetName: "Returns",
    createNewSheet: true,
  },
  "prop-acos": {
    primaryReportId: "ads-sp-campaigns",
    joinKeys: [],
    columns: [
      col("ads-sp-campaigns", "date"),
      col("ads-sp-campaigns", "campaign"),
      col("ads-sp-campaigns", "clicks"),
      col("ads-sp-campaigns", "spend"),
      col("ads-sp-campaigns", "sales_14d"),
      col("ads-sp-campaigns", "orders_14d"),
    ],
    calculatedColumns: [calc("ACOS %", "[Spend] / [Sales 14d] * 100")],
    dateRange: "last-30",
    schedule: "daily",
    sheetName: "Campaign ACOS",
    createNewSheet: true,
  },
  "tpl-inventory-health": {
    primaryReportId: "sc-fba-inventory",
    joinKeys: ["asin"],
    columns: [
      col("sc-fba-inventory", "sku"),
      col("sc-fba-inventory", "asin"),
      col("sc-fba-inventory", "fulfillable_qty"),
      col("sc-fba-inventory", "reserved_qty"),
      col("sc-fba-inventory", "unsellable_qty"),
      col("sc-sales-traffic-asin", "sessions"),
      col("sc-sales-traffic-asin", "units_ordered"),
      col("sc-reimbursements", "amount"),
    ],
    calculatedColumns: [calc("Unsellable %", "[Unsellable Qty] / [Fulfillable Qty] * 100")],
    dateRange: "last-30",
    schedule: "weekly",
    sheetName: "Inventory Health",
    createNewSheet: true,
  },
};

// ---------------------------------------------------------------------------
// Agent — keyword-routed canned answers, some carrying a proposal
// ---------------------------------------------------------------------------

interface AgentScript {
  /** Lower-cased keywords; first script with a hit wins. */
  keywords: string[];
  reply: string;
  proposal?: {
    title: string;
    summary: string;
    details: string[];
    /** Key into TEMPLATE_DRAFTS — proposals reuse the same materialisation path as templates. */
    draftKey: string;
    reportIds: string[];
    name: string;
  };
}

const AGENT_SCRIPTS: AgentScript[] = [
  {
    keywords: ["profit", "margin", "p&l", "pnl", "top 20", "best sku", "top sku"],
    reply:
      "Profit per SKU needs three things joined on ASIN: revenue from Sales & Traffic, Amazon's fees from Fee Preview, and ad spend from the Advertised Product report. I've drafted that sync — net margin comes back as a calculated column so you can sort on it straight away.",
    proposal: {
      title: "Profit by SKU, last 30 days",
      summary: "Blends revenue, fees and ad spend on ASIN, with net margin calculated.",
      details: [
        "Sales & Traffic by ASIN + Fee Preview + Advertised Product",
        "Joined on ASIN, last 30 days",
        "Calculated column: Net margin %",
        "Writes to a new tab, refreshed daily",
      ],
      draftKey: "tpl-pnl-sku",
      reportIds: ["sc-sales-traffic-asin", "sc-fees", "ads-sp-advertised-product"],
      name: "Profit by SKU",
    },
  },
  {
    keywords: ["acos", "campaign", "ppc", "wasted", "waste", "bid"],
    reply:
      "Campaign ACOS lives in the Sponsored Products campaign report. I've drafted a sync that pulls spend and 14-day sales per campaign per day and calculates ACOS — filter the sheet above 40% and you have your list. Adjust the filter in the wizard if you'd rather have the backend do it.",
    proposal: {
      title: "Campaign ACOS watchlist",
      summary: "Daily campaign spend and sales with ACOS calculated, ready to filter.",
      details: [
        "Sponsored Products — Campaigns",
        "Last 30 days, daily grain",
        "Calculated column: ACOS %",
        "Writes to a new tab, refreshed hourly",
      ],
      draftKey: "prop-acos",
      reportIds: ["ads-sp-campaigns"],
      name: "Campaign ACOS",
    },
  },
  {
    keywords: ["restock", "inventory", "stock", "cover", "reorder"],
    reply:
      "Restocking needs inventory on hand next to real velocity. I've drafted a sync joining FBA Inventory to Orders on SKU with days-of-cover calculated — sort ascending and the top of the sheet is your purchase order.",
    proposal: {
      title: "Restock planner",
      summary: "FBA inventory joined to 30-day order velocity with days of cover.",
      details: [
        "FBA Inventory + Orders",
        "Joined on SKU, last 30 days",
        "Calculated column: Days of cover",
        "Writes to a new tab, refreshed daily",
      ],
      draftKey: "tpl-restock",
      reportIds: ["sc-fba-inventory", "sc-orders"],
      name: "Restock planner",
    },
  },
  {
    keywords: ["search term", "keyword", "negative", "query"],
    reply:
      "Search-term data comes from the Sponsored Products search-term report. Drafted below: term, clicks, spend and sales per day with ACOS calculated. Terms with clicks and no sales are your negative list.",
    proposal: {
      title: "Search-term explorer",
      summary: "Every search term that spent money, with ACOS calculated.",
      details: [
        "Sponsored Products — Search Terms",
        "Last 30 days, daily grain",
        "Calculated column: ACOS %",
        "Writes to a new tab, refreshed daily",
      ],
      draftKey: "tpl-search-terms",
      reportIds: ["ads-sp-search-terms"],
      name: "Search-term explorer",
    },
  },
  {
    keywords: ["return", "refund", "defect"],
    reply:
      "Returns join to orders on SKU. Drafted a sync that keeps reason codes and disposition so you can see whether it's a listing problem or a product problem.",
    proposal: {
      title: "Returns monitor",
      summary: "Returns joined to orders on SKU with reason codes kept.",
      details: [
        "FBA Returns + Orders",
        "Joined on SKU, last 90 days",
        "Calculated column: Return rate %",
        "Writes to a new tab, refreshed daily",
      ],
      draftKey: "tpl-returns",
      reportIds: ["sc-returns", "sc-orders"],
      name: "Returns monitor",
    },
  },
];

const AGENT_FALLBACK =
  "I can build any sheet your connected Amazon data supports — profit per SKU, campaign ACOS, restock cover, search terms, returns. Tell me the question you want the sheet to answer and I'll draft the sync for you to review before anything gets written.";

// ---------------------------------------------------------------------------

export class MockBackend implements BackendClient {
  private stateCache: MockState | null = null;
  /** Continuation token → the reply that will be handed back on poll. */
  private pendingAgentReplies = new Map<string, AgentMessage>();

  private async state(): Promise<MockState> {
    if (this.stateCache) return this.stateCache;
    const stored = await storageGet<Partial<MockState>>(STORAGE_KEYS.mockState);
    const s = normalize(stored);
    // Already signed in but never seeded — an install carrying pre-2026-08-12
    // state, whose two-slot connections object normalize() just dropped. Mint
    // the fixture now rather than showing that user an empty Accounts tab.
    this.seedIfNeeded(s);
    this.stateCache = s;
    return this.stateCache;
  }

  /** Mint the demo connections once per identity. See seedConnections(). */
  private seedIfNeeded(s: MockState): void {
    if (s.connectionsSeeded || s.session === null) return;
    s.connections = seedConnections(Date.now());
    s.connectionsSeeded = true;
  }

  private async save(): Promise<void> {
    if (this.stateCache) await storageSet(STORAGE_KEYS.mockState, this.stateCache);
  }

  // ----- auth -----

  async getSession(): Promise<Session | null> {
    const s = await this.state();
    return s.session;
  }

  async googleSignIn(profile?: GoogleProfile): Promise<Session> {
    await delay(700); // popup + consent would take a moment in real life
    const s = await this.state();
    s.session = {
      userId: id("usr"),
      email: profile?.email ?? "seller@example.com",
      name: profile?.name ?? "Demo Seller",
      avatarUrl: profile?.picture,
      createdAt: Date.now(),
    };
    // The demo persona's Amazon connections are minted with the identity that
    // owns them, not baked into EMPTY_STATE: a signed-out mock has to keep
    // answering "no connections" so the empty states stay reachable, and the
    // analytics harness drives connect flows without ever signing in.
    this.seedIfNeeded(s);
    await this.save();
    return s.session;
  }

  async signOut(): Promise<void> {
    await storageRemove(STORAGE_KEYS.mockState);
    this.stateCache = null;
    this.pendingAgentReplies.clear();
  }

  // ----- sheet access -----

  async getServiceAccountEmail(_spreadsheetId?: string): Promise<string> {
    return SERVICE_ACCOUNT_EMAIL;
  }

  async checkSheetAccess(spreadsheetId: string): Promise<SheetAccess> {
    await delay(900);
    const s = await this.state();
    // Mock behaviour: any check grants access. Deliberately unchanged now that
    // the sidebar gates on access at open time (App.tsx) — a mock that could
    // answer "denied" would put the demo/QA build behind a share step nobody
    // can satisfy without a real Google service account.
    s.sheetAccess[spreadsheetId] = true;
    await this.save();
    return {
      granted: true,
      checkedAt: Date.now(),
      serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
    };
  }

  // ----- Amazon connections -----

  async startSpApiConnect(): Promise<ConnectStart> {
    await delay(300);
    return {
      provider: "amazon-selling-partner",
      // Phase 8 swaps this for the consent URL returned by
      // POST /v1/connect/amazon-selling-partner/start.
      url: chrome.runtime.getURL("mock-oauth.html") + "?provider=amazon-selling-partner",
    };
  }

  async startAdsConnect(): Promise<ConnectStart> {
    await delay(300);
    return {
      provider: "amazon-ads",
      url: chrome.runtime.getURL("mock-oauth.html") + "?provider=amazon-ads",
    };
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    const s = await this.state();
    return summarize(s.connections);
  }

  /**
   * The consent popup came back green. Mirrors the real backend: a broken
   * connection the user just re-authorised heals, and anything else is a NEW
   * connection appended to the list — which is what makes "+ Add another
   * Amazon account" actually add one in mock mode.
   */
  async completeConnect(provider: ConnectProvider): Promise<ConnectionStatus> {
    await delay(500);
    const s = await this.state();
    const broken = s.connections.find((c) => c.provider === provider && c.state !== "connected");
    if (broken) {
      broken.state = "connected";
      broken.connectedAt = Date.now();
      delete broken.error;
    } else {
      const n = s.connections.filter((c) => c.provider === provider).length + 1;
      const ads = provider === "amazon-ads";
      s.connections.push({
        id: id(ads ? "conn_ads" : "conn_sp"),
        provider,
        name: ads ? `Ballistic Brands Ads ${n}` : `Ballistic Brands ${n}`,
        externalId: ads ? `39485710293${n}` : `A2VQ8KDL91NRT${n}`,
        state: "connected",
        connectedAt: Date.now(),
        marketplaceIds: ["US", "CA", "MX"],
      });
    }
    await this.save();
    return summarize(s.connections);
  }

  /** Provider-wide: drops every connection for it, same as the real DELETE loop. */
  async disconnect(provider: ConnectProvider): Promise<ConnectionStatus> {
    await delay(600);
    const s = await this.state();
    s.connections = s.connections.filter((c) => c.provider !== provider);
    await this.save();
    return summarize(s.connections);
  }

  async disconnectAccount(connectionId: string): Promise<void> {
    await delay(600);
    const s = await this.state();
    s.connections = s.connections.filter((c) => c.id !== connectionId);
    await this.save();
  }

  async listConnections(): Promise<AmazonAccount[]> {
    await delay(280);
    const s = await this.state();
    return s.connections.map(toAccount);
  }

  async listAccounts(): Promise<AmazonAccount[]> {
    return (await this.listConnections()).filter((a) => a.state === "connected");
  }

  // ----- syncs -----

  async listSyncs(): Promise<Sync[]> {
    await delay(250);
    const s = await this.state();
    return s.syncs;
  }

  async getSync(syncId: string): Promise<Sync | null> {
    await delay(180);
    const s = await this.state();
    return s.syncs.find((x) => x.id === syncId) ?? null;
  }

  async createSync(config: SyncConfig): Promise<Sync> {
    await delay(800);
    const s = await this.state();
    const sync: Sync = {
      ...config,
      id: id("sync"),
      status: "idle",
      paused: false,
      createdAt: Date.now(),
      rowCount: 0,
    };
    s.syncs.push(sync);
    await this.save();
    return sync;
  }

  async updateSync(syncId: string, patch: SyncDraft): Promise<Sync> {
    await delay(450);
    const s = await this.state();
    const sync = s.syncs.find((x) => x.id === syncId);
    if (!sync) throw new Error(`Unknown sync: ${syncId}`);
    Object.assign(sync, patch);
    await this.save();
    return sync;
  }

  async deleteSync(syncId: string): Promise<void> {
    await delay(500);
    const s = await this.state();
    s.syncs = s.syncs.filter((x) => x.id !== syncId);
    s.runs = s.runs.filter((r) => r.syncId !== syncId);
    await this.save();
  }

  async setSyncPaused(syncId: string, paused: boolean): Promise<Sync> {
    await delay(350);
    const s = await this.state();
    const sync = s.syncs.find((x) => x.id === syncId);
    if (!sync) throw new Error(`Unknown sync: ${syncId}`);
    sync.paused = paused;
    await this.save();
    return sync;
  }

  /**
   * Run a sync. Resolves only when the run finishes — the UI shows its staged
   * progress while awaiting (the real backend reports progress over the
   * realtime channel instead; Phase 8).
   */
  async runSync(syncId: string): Promise<SyncRun> {
    const s = await this.state();
    const sync = s.syncs.find((x) => x.id === syncId);
    if (!sync) throw new Error(`Unknown sync: ${syncId}`);
    const startedAt = Date.now();
    sync.status = "running";
    await this.save();
    await delay(2000);
    const rows = estimateRows(sync);
    const run: SyncRun = {
      id: id("run"),
      syncId,
      startedAt,
      finishedAt: Date.now(),
      status: "ok",
      rows,
      message: `Wrote ${rows.toLocaleString()} rows to “${sync.sheetName}”`,
    };
    sync.status = "ok";
    sync.lastRunAt = run.finishedAt;
    sync.rowCount = rows;
    s.runs.unshift(run);
    s.runs = s.runs.slice(0, 60);
    await this.save();
    return run;
  }

  async listSyncRuns(syncId: string): Promise<SyncRun[]> {
    await delay(220);
    const s = await this.state();
    return s.runs.filter((r) => r.syncId === syncId);
  }

  /**
   * Sample rows for the review step. Values are derived from each field's
   * `sample` in the catalog, jittered per row so the preview looks like data
   * rather than a repeated line — and obviously synthetic, which is the point
   * of a mock.
   */
  async previewSync(config: SyncConfig, limit = 20): Promise<SyncPreview> {
    await delay(700);
    const fields = config.columns.map((ref) => {
      const [reportId, fieldId] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
      const field = reportById(reportId)?.fields.find((f) => f.id === fieldId);
      return { label: field?.name ?? fieldId, sample: field?.sample ?? "—", type: field?.type };
    });
    const count = Math.max(1, Math.min(50, limit));
    const rows = Array.from({ length: count }, () =>
      fields.map((f) => {
        const n = Number(f.sample.replace(/[^0-9.-]/g, ""));
        if (f.type !== "string" && f.type !== "date" && Number.isFinite(n) && n !== 0) {
          return Math.round(n * (0.6 + Math.random() * 0.8) * 100) / 100;
        }
        return f.sample;
      })
    );
    return {
      columns: [...fields.map((f) => f.label), ...config.calculatedColumns.map((c) => c.name)],
      rows: rows.map((r) => [...r, ...config.calculatedColumns.map(() => 0)]),
      truncated: true,
    };
  }

  // ----- reports -----

  async listReports(): Promise<ReportCatalogEntry[]> {
    await delay(300);
    return REPORT_CATALOG;
  }

  // ----- AI agent (202 + continuation pattern) -----

  async sendAgentMessage(content: string): Promise<AgentResult> {
    await delay(400);
    const s = await this.state();
    s.agentHistory.push({ id: id("msg"), role: "user", content, at: Date.now() });

    const script = pickScript(content);
    const reply: AgentMessage = {
      id: id("msg"),
      role: "assistant",
      content: script?.reply ?? AGENT_FALLBACK,
      at: Date.now(),
    };
    if (script?.proposal) {
      const accounts = await this.listAccounts();
      const spec = script.proposal;
      const proposal: AgentProposal = {
        id: id("prop"),
        title: spec.title,
        summary: spec.summary,
        details: spec.details,
        draft: buildDraft(spec.draftKey, spec.name, spec.reportIds, accounts),
        status: "pending",
      };
      s.proposals.push(proposal);
      reply.proposal = proposal;
    }
    await this.save();

    const token = id("cont");
    this.pendingAgentReplies.set(token, reply);
    return { status: "running", continuationToken: token, expiresAt: Date.now() + 60_000 };
  }

  async continueAgent(continuationToken: string): Promise<AgentResult> {
    await delay(1300); // "the model is thinking"
    const s = await this.state();
    const reply = this.pendingAgentReplies.get(continuationToken);
    if (!reply) {
      // Token expired / service worker restarted mid-poll — the real client
      // treats this the same way: fall back to a plain answer.
      const fallback: AgentMessage = {
        id: id("msg"),
        role: "assistant",
        content: AGENT_FALLBACK,
        at: Date.now(),
      };
      s.agentHistory.push(fallback);
      await this.save();
      return { status: "complete", message: fallback };
    }
    this.pendingAgentReplies.delete(continuationToken);
    s.agentHistory.push(reply);
    await this.save();
    return { status: "complete", message: reply };
  }

  async cancelAgent(continuationToken: string): Promise<void> {
    this.pendingAgentReplies.delete(continuationToken);
    const s = await this.state();
    s.agentHistory.push({
      id: id("msg"),
      role: "system",
      content: "Stopped.",
      at: Date.now(),
    });
    await this.save();
  }

  async getAgentHistory(): Promise<AgentMessage[]> {
    const s = await this.state();
    return s.agentHistory;
  }

  async clearAgentHistory(): Promise<void> {
    await delay(200);
    const s = await this.state();
    s.agentHistory = [];
    await this.save();
  }

  async getAgentProposal(proposalId: string): Promise<AgentProposal | null> {
    const s = await this.state();
    return s.proposals.find((p) => p.id === proposalId) ?? null;
  }

  async resolveAgentProposal(
    proposalId: string,
    status: "applied" | "discarded"
  ): Promise<AgentProposal> {
    await delay(300);
    const s = await this.state();
    const proposal = s.proposals.find((p) => p.id === proposalId);
    if (!proposal) throw new Error(`Unknown proposal: ${proposalId}`);
    proposal.status = status;
    // History carries its own copy of the proposal object; keep both in step.
    for (const m of s.agentHistory) {
      if (m.proposal?.id === proposalId) m.proposal.status = status;
    }
    await this.save();
    return proposal;
  }

  // ----- templates -----

  async listTemplates(): Promise<Template[]> {
    await delay(300);
    return TEMPLATES;
  }

  async materializeTemplate(templateId: string): Promise<SyncDraft> {
    await delay(500);
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);
    const accounts = await this.listAccounts();
    return buildDraft(templateId, template.name, template.reportIds, accounts);
  }

  // ----- workspace / plan -----

  async listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    await delay(300);
    const s = await this.state();
    if (!s.session) return WORKSPACE_MEMBERS;
    return [
      { id: "wm_owner", email: s.session.email, name: s.session.name, role: "owner", status: "active" },
    ];
  }

  async getUsage(): Promise<Usage> {
    await delay(200);
    const s = await this.state();
    const now = new Date();
    const reset = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    return {
      plan: "free",
      syncsUsed: s.syncs.length,
      syncsLimit: 2,
      // CONNECTED only — a meter that counted a revoked connection would
      // charge the user for capacity they don't have. Settings → Accounts
      // shows all of them; this number is deliberately the smaller one.
      accountsUsed: s.connections.filter((c) => c.state === "connected").length,
      accountsLimit: 5,
      rowsUsed: s.runs.reduce((sum, r) => sum + r.rows, 0),
      rowsLimit: 50_000,
      periodResetsAt: reset,
    };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function pickScript(content: string): AgentScript | undefined {
  const lower = content.toLowerCase();
  return AGENT_SCRIPTS.find((s) => s.keywords.some((k) => lower.includes(k)));
}

/** Build the source list a draft needs by matching reports to linked accounts. */
function sourcesFor(reportIds: string[], accounts: AmazonAccount[]): SyncSource[] {
  return reportIds.map((reportId) => {
    const report = reportById(reportId);
    const wanted: ConnectProvider =
      report?.source === "ads" ? "amazon-ads" : "amazon-selling-partner";
    const account = accounts.find((a) => a.provider === wanted);
    return {
      reportId,
      accountId: account?.id ?? "",
      marketplaceIds: account ? account.marketplaces.map((m) => m.id) : [],
    };
  });
}

/** Shared materialisation path for templates and agent proposals. */
function buildDraft(
  draftKey: string,
  name: string,
  reportIds: string[],
  accounts: AmazonAccount[]
): SyncDraft {
  const base = TEMPLATE_DRAFTS[draftKey] ?? {};
  return {
    ...base,
    name,
    sources: sourcesFor(reportIds, accounts),
    // Fresh ids each time so two syncs from one template don't share column ids.
    calculatedColumns: (base.calculatedColumns ?? []).map((c) => ({ ...c, id: id("cc") })),
  };
}

/**
 * Tolerate state written by an older build: fill in keys added since, and drop
 * syncs stored in the pre-blending shape (they have no `sources`).
 */
function normalize(stored: Partial<MockState> | undefined): MockState {
  const base = structuredClone(EMPTY_STATE);
  if (!stored) return base;
  return {
    session: stored.session ?? base.session,
    sheetAccess: stored.sheetAccess ?? base.sheetAccess,
    // Pre-2026-08-12 builds stored the two-slot ConnectionStatus OBJECT here.
    // There is nothing worth migrating out of it (these are fixtures, not user
    // data), so it is discarded and `connectionsSeeded` stays false — the next
    // sign-in mints the current fixture. Only a real list survives.
    connections: Array.isArray(stored.connections)
      ? stored.connections.filter((c): c is MockConnection => typeof c?.id === "string")
      : base.connections,
    connectionsSeeded: Array.isArray(stored.connections)
      ? stored.connectionsSeeded === true
      : false,
    syncs: (stored.syncs ?? []).filter((s): s is Sync => Array.isArray(s?.sources)),
    runs: stored.runs ?? [],
    agentHistory: (stored.agentHistory ?? []).filter((m) => typeof m?.id === "string"),
    proposals: stored.proposals ?? [],
  };
}
