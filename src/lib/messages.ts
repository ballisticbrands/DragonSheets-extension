/**
 * Typed message contract between contexts (content script ↔ service worker,
 * and go.getdragonsheets.com → service worker via externally_connectable).
 *
 * Convention (from the hopted teardown §3.2): one-shot
 * chrome.runtime.sendMessage with `{type, ...payload}` requests and
 * `{ok, ...}` responses. No long-lived ports.
 */
export const MSG = {
  /** Content script asks the SW to run the real Google OAuth flow (identity API is SW-only). */
  authGoogleSignIn: "AUTH_GOOGLE_SIGN_IN",
  /** Sidebar asks the SW to drop the stored `sc_` bearer (sign-out). */
  authSignOut: "AUTH_SIGN_OUT",
  /** Content script asks the SW to refresh bootstrap.json now. */
  refreshBootstrap: "REFRESH_BOOTSTRAP",
  /** Sent BY go.getdragonsheets.com pages (externally_connectable) with the attribution blob. */
  attribution: "ds-attribution",
  /**
   * Sidebar/content script asks the SW to send a GA4 Measurement Protocol
   * event. It cannot send one itself: a content-script `fetch` runs in the
   * host page's CORS context (docs.google.com), so the POST would be blocked.
   */
  analyticsEvent: "ANALYTICS_EVENT",
  /**
   * Sidebar asks the SW to make an authenticated call to
   * api.getdragonbot.com. Same reason as the analytics relay, plus one more:
   * `host_permissions` belong to the extension, not to the content script's
   * host page, so ONLY the service worker can reach the API without CORS
   * grief. RealBackend never calls `fetch` itself.
   */
  apiRequest: "API_REQUEST",
  /**
   * Sent BY https://go.getdragonsheets.com/oauth-complete/ (externally_
   * connectable) after the backend bounces the Amazon consent popup there.
   *
   * ⚠️ It is a *nudge*, nothing more: the SW re-broadcasts it so open sidebars
   * re-read /v1/connections. Activation analytics still come from connection
   * STATE via reconcileConnectionActivations(). See src/analytics/events.ts.
   */
  oauthResult: "ds-oauth-result",
  /** SW → content scripts: "an OAuth flow just finished, go re-read connections". */
  oauthResultBroadcast: "OAUTH_RESULT_BROADCAST",
} as const;

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface AuthSignInResponse {
  ok: boolean;
  profile?: GoogleProfile;
  error?: string;
}

// ---------- API relay (sidebar → service worker → api.getdragonbot.com) ----------

export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiRequestMessage {
  type: typeof MSG.apiRequest;
  method: ApiMethod;
  /** Path only, e.g. "/v1/connections" — the SW owns the base URL. */
  path: string;
  body?: unknown;
  /** Skip the Authorization header (only POST /v1/auth/google needs this). */
  anonymous?: boolean;
}

/**
 * Envelope for every relayed call. `ok` is HTTP-level success; a failed call
 * carries the backend's own `error` sentence verbatim (the contract says it is
 * written for a seller, so the UI surfaces it unchanged) plus `error_code`.
 */
export interface ApiResponseMessage<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  errorCode?: string;
}

// ---------- OAuth completion bounce ----------

export type OauthProvider = "amazon-selling-partner" | "amazon-ads";

export interface OauthResultMessage {
  type: typeof MSG.oauthResult;
  provider?: OauthProvider | string;
  /** "success" | "error"; the backend also spells success as "connected". */
  status?: string;
  connectionId?: string;
  detail?: string;
}

export interface OauthResultBroadcast {
  type: typeof MSG.oauthResultBroadcast;
  provider?: string;
  status?: string;
  at: number;
}

/**
 * Bridge payload from go.getdragonsheets.com/installed/.
 *
 * `attribution` is frontend-shared's `Attribution` shape (the LP's
 * `dragonbot_attribution` cookie / `dragonbot_attribution_v1` localStorage
 * blob). `gaClientId` is the landing page's GA4 client_id, parsed out of the
 * `_ga` cookie — it is what stitches the ad click to the in-extension
 * conversion. See src/analytics/client-id.ts.
 */
export interface AttributionMessage {
  type: typeof MSG.attribution;
  payload: {
    attribution?: Record<string, unknown>;
    gaClientId?: string;
  } & Record<string, unknown>;
}
