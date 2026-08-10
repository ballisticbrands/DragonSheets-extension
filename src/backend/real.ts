/**
 * RealBackend — `BackendClient` against sellerconnect (docs/EXTENSION_API.md).
 *
 * ## Scope
 *
 * M1 (sign-in) and M2 (Amazon connect) only. Everything the sync loop needs
 * lives behind `/v1/sheets/*`, which does not exist yet, and every one of
 * those methods throws `NotImplementedYetError` **on purpose**. Returning
 * plausible fake data from a "real" client is the single worst thing this file
 * could do: a demo would look finished, a bug report would be unreproducible,
 * and nobody would notice the backend was missing until a customer did.
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
  constructor(endpoint: string) {
    super(
      `Not built yet: ${endpoint}. DragonSheets' sync features need backend endpoints that aren't live — see docs/EXTENSION_API.md (M3).`
    );
    this.name = "NotImplementedYet";
    this.endpoint = endpoint;
  }
}

function notImplemented(endpoint: string): never {
  throw new NotImplementedYetError(endpoint);
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

  async getServiceAccountEmail(): Promise<string> {
    return notImplemented("GET /v1/sheets/access");
  }

  async checkSheetAccess(_spreadsheetId: string): Promise<SheetAccess> {
    return notImplemented("GET /v1/sheets/access");
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

  async listAccounts(): Promise<AmazonAccount[]> {
    const rows = await this.connections();
    return rows
      .filter((c) => toState(c.status) === "connected")
      .map((c) => ({
        id: c.id,
        provider: (isAds(c.provider) ? "amazon-ads" : "amazon-selling-partner") as ConnectProvider,
        name: displayName(c) ?? (isAds(c.provider) ? "Amazon Ads" : "Seller Central"),
        externalId: c.seller_id ?? c.profile_ids?.[0] ?? c.id,
        marketplaces: marketplacesOf(c),
      }));
  }

  // ----- syncs (M3: /v1/sheets/syncs) -----

  async listSyncs(): Promise<Sync[]> {
    return notImplemented("GET /v1/sheets/syncs");
  }
  async getSync(_id: string): Promise<Sync | null> {
    return notImplemented("GET /v1/sheets/syncs/:id");
  }
  async createSync(_config: SyncConfig): Promise<Sync> {
    return notImplemented("POST /v1/sheets/syncs");
  }
  async updateSync(_id: string, _patch: SyncDraft): Promise<Sync> {
    return notImplemented("PATCH /v1/sheets/syncs/:id");
  }
  async deleteSync(_id: string): Promise<void> {
    return notImplemented("DELETE /v1/sheets/syncs/:id");
  }
  async setSyncPaused(_id: string, _paused: boolean): Promise<Sync> {
    return notImplemented("PATCH /v1/sheets/syncs/:id");
  }
  async runSync(_id: string): Promise<SyncRun> {
    return notImplemented("POST /v1/sheets/syncs/:id/run");
  }
  async listSyncRuns(_id: string): Promise<SyncRun[]> {
    return notImplemented("GET /v1/sheets/syncs/:id/runs");
  }

  // ----- reports (M3: /v1/sheets/catalog) -----

  async listReports(): Promise<ReportCatalogEntry[]> {
    return notImplemented("GET /v1/sheets/catalog");
  }

  // ----- AI agent (no endpoint designed yet) -----

  async sendAgentMessage(_content: string): Promise<AgentResult> {
    return notImplemented("POST /v1/sheets/agent");
  }
  async continueAgent(_token: string): Promise<AgentResult> {
    return notImplemented("POST /v1/sheets/agent");
  }
  async cancelAgent(_token: string): Promise<void> {
    return notImplemented("POST /v1/sheets/agent");
  }
  async getAgentHistory(): Promise<AgentMessage[]> {
    return notImplemented("GET /v1/sheets/agent");
  }
  async clearAgentHistory(): Promise<void> {
    return notImplemented("DELETE /v1/sheets/agent");
  }
  async getAgentProposal(_id: string): Promise<AgentProposal | null> {
    return notImplemented("GET /v1/sheets/agent");
  }
  async resolveAgentProposal(_id: string, _status: "applied" | "discarded"): Promise<AgentProposal> {
    return notImplemented("POST /v1/sheets/agent");
  }

  // ----- templates -----

  /**
   * Templates are static copy today, but every one of them materialises into a
   * sync that `createSync` cannot create and columns that `listReports`
   * cannot name. Offering them here would be a dead end dressed as a feature.
   */
  async listTemplates(): Promise<Template[]> {
    return notImplemented("GET /v1/sheets/catalog");
  }
  async materializeTemplate(_id: string): Promise<SyncDraft> {
    return notImplemented("GET /v1/sheets/catalog");
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

  async getUsage(): Promise<Usage> {
    return notImplemented("GET /v1/sheets/usage");
  }
}
