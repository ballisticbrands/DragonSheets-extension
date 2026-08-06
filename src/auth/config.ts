/**
 * Google OAuth configuration for the *real* sign-in path.
 *
 * TODO(user-task): The GCP OAuth 2.0 client does not exist yet. To activate
 * real sign-in:
 *   1. In the dragonbot-487712 GCP project, create an OAuth client of type
 *      "Web application".
 *   2. Add the extension's identity redirect URL as an authorized redirect
 *      URI: https://<EXTENSION_ID>.chromiumapp.org/oauth2
 *      (the extension ID is only stable after the first CWS publish, or by
 *      pinning a "key" in the manifest).
 *   3. Paste the client ID below and build with VITE_AUTH_MODE=real.
 *
 * While this is null, real mode fails loudly and mock mode is the default.
 */
export const GOOGLE_OAUTH_CLIENT_ID: string | null = null;

/** OAuth scopes for the profile-only sign-in (no Sheets/Drive scopes — the
 * service-account share model means we never touch Google APIs client-side). */
export const GOOGLE_OAUTH_SCOPES = ["openid", "email", "profile"] as const;
