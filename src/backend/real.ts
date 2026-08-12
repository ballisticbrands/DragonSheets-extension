/**
 * RealBackend — `BackendClient` against sellerconnect (docs/EXTENSION_API.md).
 *
 * ## Scope
 *
 * M1 (sign-in), M2 (Amazon connect) and M3 (`/v1/sheets/*` — catalog, preview,
 * sync CRUD, run, runs, access) are live and implemented here against the real
 * endpoints.
 *
 * What is NOT live is the **agent**: the backend has no agent surface at all.
 * Those methods still refuse to answer — returning plausible fake data from a
 * "real" client is the single worst thing this file could do: a demo would
 * look finished, a bug report would be unreproducible, and nobody would notice
 * the backend was missing until a customer did. They refuse *politely* though,
 * with a sentence written for a seller (`AGENT_UNAVAILABLE`), because the
 * agent screen renders a thrown message straight into its error slot.
 *
 * ## No fetch here
 *
 * This class runs in the sidebar, i.e. inside a content script on
 * docs.google.com. It has no `host_permissions` of its own and must not hold
 * the session token, so every call is relayed to the service worker as
 * `MSG.apiRequest`; src/backend/http.ts does the actual networking.
 */
import type { GoogleProfile } from "../lib/messages";
import { MSG, type ApiMethod, type ApiResponseMessage } from "../lib/messages";
import { OAUTH_RETURN_TO } from "./config";
import {
  fromWireRun,
  fromWireSync,
  toCatalogEntries,
  toWirePreviewBody,
  toWireSyncBody,
  toWireSyncPatch,
  type WireAccess,
  type WireCatalogEntry,
  type WireRun,
  type WireSync,
} from "./sheets-wire";
import type {
  AgentMessage,
  AgentProposal,
  AgentResult,
  AmazonAccount,
  BackendClient,
  ConnectProvider,
  ConnectStart,
  ConnectionState,
  ConnectionStatus,
  Marketplace,
  ReportCatalogEntry,
  Session,
  SheetAccess,
  Sync,
  SyncConfig,
  SyncDraft,
  SyncPreview,
  SyncRun,
  Template,
  Usage,
  WorkspaceMember,
} from "./types";

/**
 * Thrown by every method whose endpoint the backend has not built yet.
 * Named so the UI (and a bug report) can tell "not built" apart from "broke".
 */
export class NotImplementedYetError extends Error {
  readonly endpoint: string;
  constructor(endpoint: string, message?: string) {
    super(
      message ??
        `Not built yet: ${endpoint}. DragonSheets' sync features need backend endpoints that aren't live — see docs/EXTENSION_API.md.`
    );
    this.name = "NotImplementedYet";
    this.endpoint = endpoint;
  }
}

/**
 * The sentence the agent screen shows. It is deliberately a *product*
 * sentence, not a stack trace: the user did nothing wrong and there is a
 * working path for them one screen away.
 */
export const AGENT_UNAVAILABLE =
  "The AI agent isn't switched on yet. Build the sheet you want with the sync wizard in the meantime — it reaches exactly the same data.";

function notImplemented(endpoint: string, message?: string): never {
  throw new NotImplementedYetError(endpoint, message);
}

/** An error carrying the backend's own seller-facing sentence. */
export class ApiError extends Error {
  readonly status: number;
  readonly errorCode?: string;
  constructor(res: ApiResponseMessage) {
    super(res.error ?? `The server returned an error (HTTP ${res.status}).`);
    this.name = "ApiError";
    this.status = res.status;
    this.errorCode = res.errorCode;
  }
}

/** Relay one call through the service worker. */
async function api<T>(method: ApiMethod, path: string, body?: unknown): Promise<T> {
  const res = (await chrome.runtime.sendMessage({
    type: MSG.apiRequest,
    method,
    path,
    body,
  })) as ApiResponseMessage<T> | undefined;

  if (!res) {
    // The SW was asleep and the message went nowhere, or it threw before
    // responding. Either way the caller must not get `undefined` back.
    throw new Error("DragonSheets' background service didn't respond. Reload the page and retry.");
  }
  if (!res.ok) throw new ApiError(res);
  return res.data as T;
}

// ─── /v1/connections wire shape ────────────────────────────────────────────

/**
 * As sellerconnect's `toFrontendShape()` serialises it
 * (src/routes/connections.ts). Fields we don't use are omitted rather than
 * typed loosely — an unexpected extra key is harmless, a wrong assumption is
 * not.
 */
interface WireConnection {
  id: string;
  /** "amazon-selling-partner" | "amazon-ads" (dashes, not underscores). */
  provider: string;
  status: "pending" | "syncing" | "connected" | "error" | "expired";
  connected_at: string;
  error: string | null;
  name: string | null;
  seller_id: string | null;
  marketplace_ids: string[];
  countries: string[];
  profile_ids: string[];
  account_name: string | null;
}

/**
 * Backend status → the extension's four-state model.
 *
 * `syncing` maps to "pending", not "connected": the OAuth handshake finished
 * but identity hasn't resolved, so there is nothing to name the account with
 * yet. Mapping it to "connected" would make `reconcileConnectionActivations()`
 * fire a conversion for a connection that may still fail.
 */
function toState(status: WireConnection["status"]): ConnectionState {
  switch (status) {
    case "connected":
      return "connected";
    case "error":
    case "expired":
      return "error";
    default:
      return "pending";
  }
}

function isAds(provider: string): boolean {
  return provider.toLowerCase().replace(/_/g, "-").includes("ads");
}

function displayName(c: WireConnection): string | undefined {
  return c.account_name ?? c.name ?? c.seller_id ?? undefined;
}

function connectedAtMs(c: WireConnection): number | undefined {
  const t = Date.parse(c.connected_at);
  return Number.isFinite(t) ? t : undefined;
}

/** Marketplace ids are all the wire gives us; countries fill in the labels. */
function marketplacesOf(c: WireConnection): Marketplace[] {
  const ids = c.marketplace_ids?.length ? c.marketplace_ids : c.profile_ids;
  return (ids ?? []).map((id, i) => {
    const country = c.countries?.[i] ?? "";
    return { id, countryCode: country, name: country ? `${country} (${id})` : id };
  });
}

// ─── /v1/auth/me wire shape ────────────────────────────────────────────────

interface WireProfile {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

// ───────────────────────────────────────────────────────────────────────────

export class RealBackend implements BackendClient {
  // ----- auth -----

  async getSession(): Promise<Session | null> {
    try {
      const me = await api<WireProfile>("GET", "/v1/auth/me");
      return {
        userId: me.id,
        email: me.email,
        name: me.name ?? me.email,
        createdAt: Date.parse(me.createdAt) || Date.now(),
      };
    } catch (err) {
      // 401 is the ordinary "signed out" answer, not an error to surface.
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }

  /**
   * The OAuth round trip and the `POST /v1/auth/google` exchange already
   * happened in the service worker (src/auth/real.ts) — by the time this runs
   * the `sc_` bearer is stored. All that's left is to read the session back so
   * the UI has a real user id for `user_id` in analytics.
   */
  async googleSignIn(_profile?: GoogleProfile): Promise<Session> {
    const session = await this.getSession();
    if (!session) throw new Error("Signed in with Google, but the session didn't stick. Try again.");
    return session;
  }

  async signOut(): Promise<void> {
    // Best-effort revoke; the SW clears the stored token either way.
    await api<void>("POST", "/v1/auth/sign-out").catch(() => undefined);
    await chrome.runtime.sendMessage({ type: MSG.authSignOut }).catch(() => undefined);
  }

  // ----- sheet access -----

  /**
   * `GET /v1/sheets/access?spreadsheet_id=…`
   *
   * The one endpoint that answers two questions at once: *can* the service
   * account open this sheet, and *which address* does the user have to share
   * it with. The backend returns the address on both answers — including the
   * denial — which is exactly what the share screen needs, because a user who
   * has no access yet is precisely the user who needs the address.
   */
  private async accessWire(spreadsheetId: string): Promise<WireAccess> {
    // The backend 400s on an empty id (`invalid_request`). "unknown" is what
    // App.tsx uses when the URL has no spreadsheet in it; send it through and
    // let the server answer "no access" — it still names the address, which is
    // the part the UI cannot do without.
    const id = spreadsheetId && spreadsheetId !== "unknown" ? spreadsheetId : "unknown";
    return api<WireAccess>("GET", `/v1/sheets/access?spreadsheet_id=${encodeURIComponent(id)}`);
  }

  async getServiceAccountEmail(spreadsheetId?: string): Promise<string> {
    const res = await this.accessWire(spreadsheetId ?? "");
    const email = res?.service_account_email ?? "";
    if (!email) {
      // Sheets isn't configured on the server. There is nothing for the user
      // to copy and no amount of retrying will change that, so say so rather
      // than rendering an empty box.
      throw new Error(
        res?.reason ??
          "The server hasn't been given its Google Sheets credentials yet, so there's no address to share with. Contact support."
      );
    }
    return email;
  }

  async checkSheetAccess(spreadsheetId: string): Promise<SheetAccess> {
    const res = await this.accessWire(spreadsheetId);
    return {
      // `has_access` is the wire spelling; the UI reads `granted`.
      granted: res?.has_access === true,
      checkedAt: Date.now(),
      serviceAccountEmail: res?.service_account_email ?? null,
      ...(res?.reason ? { reason: res.reason } : {}),
    };
  }

  // ----- Amazon connections -----

  private async connections(): Promise<WireConnection[]> {
    const rows = await api<WireConnection[]>("GET", "/v1/connections");
    return Array.isArray(rows) ? rows : [];
  }

  async startSpApiConnect(): Promise<ConnectStart> {
    return this.startConnect("amazon-selling-partner");
  }

  async startAdsConnect(): Promise<ConnectStart> {
    return this.startConnect("amazon-ads");
  }

  private async startConnect(provider: ConnectProvider): Promise<ConnectStart> {
    const path =
      provider === "amazon-ads"
        ? "/v1/connect/amazon-ads/start"
        : "/v1/connect/amazon-selling-partner/start";
    const res = await api<{ authorization_url?: string }>("POST", path, {
      return_to: OAUTH_RETURN_TO,
    });
    if (!res?.authorization_url) {
      throw new Error("Amazon didn't return a consent link. Please try again.");
    }
    return { provider, url: res.authorization_url };
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    const rows = await this.connections();
    const status: ConnectionStatus = {
      sellerCentral: { state: "disconnected" },
      ads: { state: "disconnected" },
    };
    for (const c of rows) {
      const slot = isAds(c.provider) ? status.ads : status.sellerCentral;
      const state = toState(c.status);
      // Multiple connections per provider are possible; the best one wins, so
      // one broken re-connect attempt can't hide a working account.
      const rank: Record<ConnectionState, number> = {
        connected: 3,
        pending: 2,
        error: 1,
        disconnected: 0,
      };
      if (rank[state] <= rank[slot.state] && slot.state !== "disconnected") continue;
      slot.state = state;
      slot.accountName = displayName(c);
      slot.connectedAt = connectedAtMs(c);
    }
    return status;
  }

  /**
   * The backend created the Connection during its OAuth callback, so there is
   * nothing to "complete" — re-read the truth instead of asserting it.
   */
  async completeConnect(_provider: ConnectProvider): Promise<ConnectionStatus> {
    return this.getConnectionStatus();
  }

  async disconnect(provider: ConnectProvider): Promise<ConnectionStatus> {
    const rows = await this.connections();
    const targets = rows.filter((c) => isAds(c.provider) === (provider === "amazon-ads"));
    for (const c of targets) await api<void>("DELETE", `/v1/connections/${c.id}`);
    return this.getConnectionStatus();
  }

  async disconnectAccount(connectionId: string): Promise<void> {
    await api<void>("DELETE", `/v1/connections/${encodeURIComponent(connectionId)}`);
  }

  /**
   * One model object per row of /v1/connections — nothing collapsed. A seller
   * with two Seller Central accounts gets two entries here, and an expired
   * connection is still an entry (state "error") because this list is the only
   * place the UI can offer a reconnect for it.
   */
  async listConnections(): Promise<AmazonAccount[]> {
    const rows = await this.connections();
    return rows.map((c) => {
      const ads = isAds(c.provider);
      const account: AmazonAccount = {
        id: c.id,
        provider: (ads ? "amazon-ads" : "amazon-selling-partner") as ConnectProvider,
        name: displayName(c) ?? (ads ? "Amazon Ads" : "Seller Central"),
        externalId: c.seller_id ?? c.profile_ids?.[0] ?? c.id,
        marketplaces: marketplacesOf(c),
        state: toState(c.status),
      };
      const at = connectedAtMs(c);
      if (at !== undefined) account.connectedAt = at;
      if (c.error) account.error = c.error;
      return account;
    });
  }

  /** The connected subset — see BackendClient.listAccounts. */
  async listAccounts(): Promise<AmazonAccount[]> {
    return (await this.listConnections()).filter((a) => a.state === "connected");
  }

  // ----- syncs (M3: /v1/sheets/syncs) -----

  /**
   * A sync is scoped to a spreadsheet server-side, but the sidebar only ever
   * shows the sheet it is injected into — so the list is filtered to the
   * current spreadsheet. Anything else would offer to run a sync that writes
   * into a document the user isn't looking at.
   */
  private currentSpreadsheetId(): string {
    try {
      const m = /\/spreadsheets\/d\/([^/]+)/.exec(location.href);
      return m?.[1] ?? "";
    } catch {
      // No `location` (the unit harness runs this class under node).
      return "";
    }
  }

  async listSyncs(): Promise<Sync[]> {
    const res = await api<{ syncs?: WireSync[] }>("GET", "/v1/sheets/syncs");
    const here = this.currentSpreadsheetId();
    return (res?.syncs ?? [])
      .filter((s) => (here ? s.spreadsheet_id === here : true))
      .map(fromWireSync);
  }

  async getSync(id: string): Promise<Sync | null> {
    try {
      return fromWireSync(await api<WireSync>("GET", `/v1/sheets/syncs/${encodeURIComponent(id)}`));
    } catch (err) {
      // `sync_not_found` is an answer, not a failure — the caller renders an
      // empty state for it.
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  async createSync(config: SyncConfig): Promise<Sync> {
    const body = toWireSyncBody(config, this.currentSpreadsheetId());
    return fromWireSync(await api<WireSync>("POST", "/v1/sheets/syncs", body));
  }

  /**
   * PATCH takes the same field names as POST and validates the MERGED config,
   * so a partial draft is safe to send as-is. Only the keys the caller
   * actually set are included — sending `undefined` ones would fail schema
   * validation with `invalid_request`.
   */
  async updateSync(id: string, patch: SyncDraft): Promise<Sync> {
    const body = toWireSyncPatch(patch);
    return fromWireSync(
      await api<WireSync>("PATCH", `/v1/sheets/syncs/${encodeURIComponent(id)}`, body)
    );
  }

  async deleteSync(id: string): Promise<void> {
    await api<void>("DELETE", `/v1/sheets/syncs/${encodeURIComponent(id)}`);
  }

  async setSyncPaused(id: string, paused: boolean): Promise<Sync> {
    return fromWireSync(
      await api<WireSync>("PATCH", `/v1/sheets/syncs/${encodeURIComponent(id)}`, {
        status: paused ? "paused" : "active",
      })
    );
  }

  /**
   * `202 { run_id }` — the endpoint queues the run and returns immediately, so
   * the run we hand back is the *started* state, not the finished one. The UI
   * polls `listSyncRuns` for the outcome.
   */
  async runSync(id: string): Promise<SyncRun> {
    const res = await api<{ run_id?: string }>(
      "POST",
      `/v1/sheets/syncs/${encodeURIComponent(id)}/run`
    );
    return {
      id: res?.run_id ?? `run_${Date.now()}`,
      syncId: id,
      startedAt: Date.now(),
      status: "running",
      rows: 0,
      message: "Queued — the sheet updates as soon as the rows are ready.",
    };
  }

  async listSyncRuns(id: string): Promise<SyncRun[]> {
    const res = await api<{ runs?: WireRun[] }>(
      "GET",
      `/v1/sheets/syncs/${encodeURIComponent(id)}/runs`
    );
    return (res?.runs ?? []).map((r) => fromWireRun(r, id));
  }

  async previewSync(config: SyncConfig, limit = 20): Promise<SyncPreview> {
    const res = await api<{
      columns?: string[];
      rows?: Array<Array<string | number | boolean | null>>;
      truncated?: boolean;
    }>("POST", "/v1/sheets/preview", toWirePreviewBody(config, limit));
    return {
      columns: res?.columns ?? [],
      rows: res?.rows ?? [],
      truncated: res?.truncated === true,
    };
  }

  // ----- reports (M3: /v1/sheets/catalog) -----

  async listReports(): Promise<ReportCatalogEntry[]> {
    const res = await api<{ reports?: WireCatalogEntry[] }>("GET", "/v1/sheets/catalog");
    return toCatalogEntries(res?.reports ?? []);
  }

  // ----- AI agent (no endpoint designed yet) -----
  //
  // The reads answer emptily — an empty transcript IS the truth, and throwing
  // from a mount-time read only produces an unhandled rejection and a screen
  // stuck on a spinner. Anything that would need the model to actually run
  // refuses, with AGENT_UNAVAILABLE, which the Agent screen renders inline.

  async sendAgentMessage(_content: string): Promise<AgentResult> {
    return notImplemented("POST /v1/sheets/agent", AGENT_UNAVAILABLE);
  }
  async continueAgent(_token: string): Promise<AgentResult> {
    return notImplemented("POST /v1/sheets/agent", AGENT_UNAVAILABLE);
  }
  async cancelAgent(_token: string): Promise<void> {
    // Nothing was started, so there is nothing to cancel. Refusing here would
    // turn the Stop button into a second error.
  }
  async getAgentHistory(): Promise<AgentMessage[]> {
    return [];
  }
  async clearAgentHistory(): Promise<void> {
    // No history is stored server-side; clearing it is already true.
  }
  async getAgentProposal(_id: string): Promise<AgentProposal | null> {
    return null;
  }
  async resolveAgentProposal(_id: string, _status: "applied" | "discarded"): Promise<AgentProposal> {
    return notImplemented("POST /v1/sheets/agent", AGENT_UNAVAILABLE);
  }

  // ----- templates -----

  /**
   * The templates in src/backend/catalog.ts name mock report ids
   * (`sc-sales-traffic-asin`) and mock column ids. Against the live catalog —
   * whose ids are real BigQuery table names — every one of them would
   * materialise into a draft referencing columns that do not exist, and fail
   * at `POST /syncs` with `invalid_source`.
   *
   * An empty gallery with an explanation (Templates.tsx) beats a gallery of
   * cards that all fail on click.
   */
  async listTemplates(): Promise<Template[]> {
    return [];
  }
  async materializeTemplate(id: string): Promise<SyncDraft> {
    return notImplemented(
      "GET /v1/sheets/catalog",
      `Templates aren't available against live data yet (${id}). Build this one in the sync wizard instead.`
    );
  }

  // ----- workspace / plan -----

  async listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    const session = await this.getSession();
    if (!session) return [];
    // Single-seat until sellerconnect grows a workspace model. Reporting the
    // signed-in user is a fact, not a fixture.
    return [
      {
        id: session.userId,
        email: session.email,
        name: session.name,
        role: "owner",
        status: "active",
      },
    ];
  }

  /**
   * There is no `/v1/sheets/usage`, and no billing or metering anywhere in
   * sellerconnect — nothing server-side counts syncs, accounts or rows, and
   * nothing enforces a cap.
   *
   * So: the **used** figures are real (counted from the syncs and connections
   * the API just returned), and the **limits** are display-only ceilings set
   * high enough that they cannot block a user against a backend that does not
   * enforce them. Throwing instead is not an option — the sync wizard awaits
   * this alongside the catalog, so a rejection here leaves the wizard on a
   * spinner forever, which is how this surfaced in the first place.
   */
  async getUsage(): Promise<Usage> {
    const [syncs, accounts] = await Promise.all([
      this.listSyncs().catch(() => [] as Sync[]),
      this.listAccounts().catch(() => [] as AmazonAccount[]),
    ]);
    const now = new Date();
    return {
      plan: "free",
      syncsUsed: syncs.length,
      syncsLimit: 25,
      // listAccounts(), not listConnections(): a usage meter that counted a
      // broken connection would bill for capacity the user does not have.
      accountsUsed: accounts.length,
      accountsLimit: 10,
      // Rows written by each sync's most recent run — the only row figure the
      // API actually reports. Not a billing meter, and not presented as one.
      rowsUsed: syncs.reduce((sum, s) => sum + (s.rowCount ?? 0), 0),
      rowsLimit: 1_000_000,
      periodResetsAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
    };
  }
}
