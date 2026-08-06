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
