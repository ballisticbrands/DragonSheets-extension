/**
 * MockBackend — realistic-latency, chrome.storage.local-persisted fake
 * implementation of BackendClient. The entire product surface runs against
 * this until Phase 8 lands the real backend.
 */
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from "../lib/storage";
import type { GoogleProfile } from "../lib/messages";
import type {
  AgentMessage,
  AgentResult,
  BackendClient,
  ConnectProvider,
  ConnectStart,
  ConnectionStatus,
  ReportCatalogEntry,
  Session,
  SheetAccess,
  Sync,
  SyncConfig,
  Template,
  Usage,
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
  agentHistory: AgentMessage[];
}

const EMPTY_STATE: MockState = {
  session: null,
  sheetAccess: {},
  connections: {
    sellerCentral: { state: "disconnected" },
    ads: { state: "disconnected" },
  },
  syncs: [],
  agentHistory: [],
};

/** Realistic latency: base ± jitter, so loading states are actually visible. */
function delay(baseMs: number): Promise<void> {
  const ms = baseMs + Math.random() * baseMs * 0.5;
  return new Promise((r) => setTimeout(r, ms));
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Report catalog — names mirror the real BigQuery report catalog (SP-API core + Ads v3) so the mock matches what the backend can actually serve. */
const REPORT_CATALOG: ReportCatalogEntry[] = [
  { id: "sc-orders", name: "Orders", source: "seller-central", description: "Order-level detail: status, SKU, quantities, revenue.", columns: ["order_id", "purchase_date", "sku", "asin", "quantity", "item_price", "order_status", "marketplace"] },
  { id: "sc-sales-traffic-asin", name: "Sales & Traffic by ASIN", source: "seller-central", description: "Sessions, page views, buy-box %, units and revenue per ASIN per day.", columns: ["date", "asin", "sessions", "page_views", "buy_box_pct", "units_ordered", "ordered_product_sales"] },
  { id: "sc-fba-inventory", name: "FBA Inventory", source: "seller-central", description: "Fulfillable, inbound, reserved and unsellable units per SKU.", columns: ["sku", "asin", "fulfillable_qty", "inbound_qty", "reserved_qty", "unsellable_qty"] },
  { id: "sc-fees", name: "Fee Preview", source: "seller-central", description: "Estimated referral + FBA fees per SKU.", columns: ["sku", "asin", "price", "referral_fee", "fba_fee", "total_fee_estimate"] },
  { id: "sc-returns", name: "FBA Returns", source: "seller-central", description: "Customer returns with reason codes and disposition.", columns: ["return_date", "order_id", "sku", "quantity", "reason", "disposition"] },
  { id: "sc-reimbursements", name: "Reimbursements", source: "seller-central", description: "FBA reimbursements: lost, damaged, fee corrections.", columns: ["approval_date", "case_id", "sku", "quantity", "amount", "reason"] },
  { id: "sc-search-query-perf", name: "Search Query Performance", source: "seller-central", description: "Brand-analytics query funnel: impressions, clicks, purchases per search query.", columns: ["query", "impressions", "clicks", "cart_adds", "purchases", "purchase_share"] },
  { id: "ads-sp-campaigns", name: "Sponsored Products - Campaigns", source: "ads", description: "Campaign-level spend, sales, ACOS, clicks per day.", columns: ["date", "campaign", "impressions", "clicks", "spend", "sales_14d", "acos", "orders_14d"] },
  { id: "ads-sp-search-terms", name: "Sponsored Products - Search Terms", source: "ads", description: "Actual customer search terms with performance per term.", columns: ["date", "campaign", "ad_group", "search_term", "impressions", "clicks", "spend", "sales_14d"] },
  { id: "ads-sp-advertised-product", name: "Sponsored Products - Advertised Product", source: "ads", description: "Per-advertised-ASIN ad performance.", columns: ["date", "campaign", "asin", "sku", "impressions", "clicks", "spend", "sales_14d"] },
  { id: "ads-sp-targeting", name: "Sponsored Products - Targeting", source: "ads", description: "Keyword / product-target level performance.", columns: ["date", "campaign", "ad_group", "targeting", "match_type", "impressions", "clicks", "spend", "sales_14d"] },
  { id: "ads-sb-campaigns", name: "Sponsored Brands - Campaigns", source: "ads", description: "SB campaign performance incl. new-to-brand metrics.", columns: ["date", "campaign", "impressions", "clicks", "spend", "sales_14d", "ntb_orders_14d"] },
  { id: "ads-sd-campaigns", name: "Sponsored Display - Campaigns", source: "ads", description: "SD campaign performance across audiences.", columns: ["date", "campaign", "tactic", "impressions", "clicks", "spend", "sales_14d"] },
  { id: "ads-placements", name: "Sponsored Products - Placements", source: "ads", description: "Top-of-search vs product-page vs rest-of-search split.", columns: ["date", "campaign", "placement", "impressions", "clicks", "spend", "sales_14d"] },
];

const TEMPLATES: Template[] = [
  { id: "tpl-pnl-sku", name: "P&L by SKU", description: "Revenue, fees, ad spend and margin per SKU in one sheet.", reportIds: ["sc-sales-traffic-asin", "sc-fees", "ads-sp-advertised-product"] },
  { id: "tpl-tacos", name: "TACOS dashboard", description: "Total advertising cost of sales, trended daily.", reportIds: ["sc-sales-traffic-asin", "ads-sp-campaigns"] },
  { id: "tpl-restock", name: "Restock planner", description: "FBA inventory vs sales velocity with day-of-cover.", reportIds: ["sc-fba-inventory", "sc-orders"] },
  { id: "tpl-search-terms", name: "Search-term explorer", description: "Every search term that spent money, with waste flags.", reportIds: ["ads-sp-search-terms"] },
  { id: "tpl-returns", name: "Returns monitor", description: "Return rate per SKU with reason breakdown.", reportIds: ["sc-returns", "sc-orders"] },
  { id: "tpl-ppc-waste", name: "PPC wasted-spend audit", description: "Zero-sale targets and placements burning budget.", reportIds: ["ads-sp-targeting", "ads-placements"] },
];

const CANNED_AGENT_REPLY =
  "I can build that report. I'd pull **Sponsored Products - Search Terms** for the last 30 days, keep terms with spend > $5 and zero orders, and write them to a new sheet sorted by spend. Backend isn't wired up yet — once live syncs are online I'll create it for you here.";

export class MockBackend implements BackendClient {
  private stateCache: MockState | null = null;
  private pendingAgentReply: AgentMessage | null = null;

  private async state(): Promise<MockState> {
    if (this.stateCache) return this.stateCache;
    const stored = await storageGet<MockState>(STORAGE_KEYS.mockState);
    this.stateCache = stored ?? structuredClone(EMPTY_STATE);
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

  // ----- syncs -----

  async listSyncs(): Promise<Sync[]> {
    await delay(250);
    const s = await this.state();
    return s.syncs;
  }

  async createSync(config: SyncConfig): Promise<Sync> {
    await delay(800);
    const s = await this.state();
    const sync: Sync = { ...config, id: id("sync"), status: "ok", createdAt: Date.now(), lastRunAt: Date.now() };
    s.syncs.push(sync);
    await this.save();
    return sync;
  }

  async runSync(syncId: string): Promise<Sync> {
    await delay(1500);
    const s = await this.state();
    const sync = s.syncs.find((x) => x.id === syncId);
    if (!sync) throw new Error(`Unknown sync: ${syncId}`);
    sync.status = "ok";
    sync.lastRunAt = Date.now();
    await this.save();
    return sync;
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
    s.agentHistory.push({ role: "user", content, at: Date.now() });
    await this.save();
    this.pendingAgentReply = { role: "assistant", content: CANNED_AGENT_REPLY, at: Date.now() };
    return {
      status: "running",
      continuationToken: id("cont"),
      expiresAt: Date.now() + 60_000,
    };
  }

  async continueAgent(_continuationToken: string): Promise<AgentResult> {
    await delay(1200); // "the model is thinking"
    const s = await this.state();
    const reply = this.pendingAgentReply ?? { role: "assistant" as const, content: CANNED_AGENT_REPLY, at: Date.now() };
    this.pendingAgentReply = null;
    s.agentHistory.push(reply);
    await this.save();
    return { status: "complete", message: reply };
  }

  async getAgentHistory(): Promise<AgentMessage[]> {
    const s = await this.state();
    return s.agentHistory;
  }

  // ----- templates -----

  async listTemplates(): Promise<Template[]> {
    await delay(300);
    return TEMPLATES;
  }

  // ----- usage -----

  async getUsage(): Promise<Usage> {
    await delay(200);
    const s = await this.state();
    return {
      plan: "free",
      syncsUsed: s.syncs.length,
      syncsLimit: 2,
      accountsUsed:
        (s.connections.sellerCentral.state === "connected" ? 1 : 0) +
        (s.connections.ads.state === "connected" ? 1 : 0),
      accountsLimit: 2,
    };
  }
}
