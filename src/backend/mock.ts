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
  ConnectionStatus,
  DateRangePreset,
  Marketplace,
  ReportCatalogEntry,
  Session,
  SheetAccess,
  Sync,
  SyncConfig,
  SyncDraft,
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
  connections: ConnectionStatus;
  syncs: Sync[];
  runs: SyncRun[];
  agentHistory: AgentMessage[];
  proposals: AgentProposal[];
}

const EMPTY_STATE: MockState = {
  session: null,
  sheetAccess: {},
  connections: {
    sellerCentral: { state: "disconnected" },
    ads: { state: "disconnected" },
  },
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

const DATE_RANGE_FACTOR: Record<DateRangePreset, number> = {
  "last-7": 0.25,
  "last-30": 1,
  "last-90": 2.6,
  ytd: 6,
  all: 9.5,
};

const WORKSPACE_MEMBERS: WorkspaceMember[] = [
  { id: "wm_owner", email: "owner@ballisticbrands.co", name: "You", role: "owner", status: "active" },
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
    this.stateCache = normalize(stored);
    return this.stateCache;
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
    await this.save();
    return s.session;
  }

  async signOut(): Promise<void> {
    await storageRemove(STORAGE_KEYS.mockState);
    this.stateCache = null;
    this.pendingAgentReplies.clear();
  }

  // ----- sheet access -----

  async getServiceAccountEmail(): Promise<string> {
    return SERVICE_ACCOUNT_EMAIL;
  }

  async checkSheetAccess(spreadsheetId: string): Promise<SheetAccess> {
    await delay(900);
    const s = await this.state();
    // Mock behaviour: the first explicit "Check access" click grants access
    // (the real implementation asks the backend to touch the sheet as the
    // service account — Phase 8.2).
    s.sheetAccess[spreadsheetId] = true;
    await this.save();
    return { granted: true, checkedAt: Date.now() };
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
    return s.connections;
  }

  async completeConnect(provider: ConnectProvider): Promise<ConnectionStatus> {
    await delay(500);
    const s = await this.state();
    const target = provider === "amazon-selling-partner" ? s.connections.sellerCentral : s.connections.ads;
    target.state = "connected";
    target.accountName = provider === "amazon-selling-partner" ? "Ballistic Brands (US)" : "Ballistic Brands Ads";
    target.connectedAt = Date.now();
    await this.save();
    return s.connections;
  }

  async disconnect(provider: ConnectProvider): Promise<ConnectionStatus> {
    await delay(600);
    const s = await this.state();
    const target = provider === "amazon-selling-partner" ? s.connections.sellerCentral : s.connections.ads;
    target.state = "disconnected";
    delete target.accountName;
    delete target.connectedAt;
    await this.save();
    return s.connections;
  }

  async listAccounts(): Promise<AmazonAccount[]> {
    await delay(280);
    const s = await this.state();
    const accounts: AmazonAccount[] = [];
    if (s.connections.sellerCentral.state === "connected") {
      accounts.push({
        id: "acct_sp_main",
        provider: "amazon-selling-partner",
        name: s.connections.sellerCentral.accountName ?? "Seller Central",
        externalId: "A2VQ8KDL91NRT4",
        marketplaces: MARKETPLACES.slice(0, 3),
      });
    }
    if (s.connections.ads.state === "connected") {
      accounts.push({
        id: "acct_ads_main",
        provider: "amazon-ads",
        name: s.connections.ads.accountName ?? "Amazon Ads",
        externalId: "3948571029384",
        marketplaces: MARKETPLACES.slice(0, 3),
      });
    }
    return accounts;
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
      accountsUsed:
        (s.connections.sellerCentral.state === "connected" ? 1 : 0) +
        (s.connections.ads.state === "connected" ? 1 : 0),
      accountsLimit: 2,
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
    connections: stored.connections ?? base.connections,
    syncs: (stored.syncs ?? []).filter((s): s is Sync => Array.isArray(s?.sources)),
    runs: stored.runs ?? [],
    agentHistory: (stored.agentHistory ?? []).filter((m) => typeof m?.id === "string"),
    proposals: stored.proposals ?? [],
  };
}
