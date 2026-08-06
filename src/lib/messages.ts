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

export interface AttributionMessage {
  type: typeof MSG.attribution;
  payload: Record<string, unknown>;
}
