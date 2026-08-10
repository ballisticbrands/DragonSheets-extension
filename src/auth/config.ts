/**
 * Google OAuth configuration for the *real* sign-in path.
 *
 * This is the **shared Dragon Suite OAuth Web client** — one client serves
 * every Dragon product (see Dragon-marketing/skills/new-product-funnel §0).
 * We deliberately do NOT mint a per-product client. The client *secret* is
 * unused and must never be stored here: `launchWebAuthFlow` uses the implicit
 * / ID-token flow, which is secret-less by design.
 *
 * ⚠️ TODO(user-task): this client ID alone is not enough to make real sign-in
 * work. The extension's redirect URL must be registered on the client, and it
 * contains the extension ID, which is only stable after the first Chrome Web
 * Store publish (or by pinning a `key` in the manifest). So, once published:
 *
 *   1. GCP console (project dragonbot-487712) → APIs & Services → Credentials
 *      → this client → Authorized redirect URIs → add:
 *        https://<EXTENSION_ID>.chromiumapp.org/oauth2
 *   2. Rebuild with VITE_AUTH_MODE=real.
 *
 * Until that redirect URI exists, real mode fails at the consent screen with
 * `redirect_uri_mismatch`; mock mode remains the default and is unaffected.
 */
export const GOOGLE_OAUTH_CLIENT_ID: string | null =
  "776606808148-8p8l20pg1vt4jcbde2rr1orvlku87b55.apps.googleusercontent.com";

/** OAuth scopes for the profile-only sign-in (no Sheets/Drive scopes — the
 * service-account share model means we never touch Google APIs client-side). */
export const GOOGLE_OAUTH_SCOPES = ["openid", "email", "profile"] as const;
