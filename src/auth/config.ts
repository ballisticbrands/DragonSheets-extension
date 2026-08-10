/**
 * Google OAuth configuration for the *real* sign-in path.
 *
 * This is the **shared Dragon Suite OAuth Web client** — one client serves
 * every Dragon product (see Dragon-marketing/skills/new-product-funnel §0).
 * We deliberately do NOT mint a per-product client. The client *secret* is
 * unused and must never be stored here: the extension runs a secret-less
 * browser flow, and any exchange that needs the secret happens on the backend.
 *
 * Verified 2026-08-10: the extension's redirect URI
 *   https://papoimmliahhmamjdagmajeddimpmojo.chromiumapp.org/oauth2
 * is registered on this client, and sellerconnect's `POST /v1/auth/google`
 * verifies ID tokens against this same client ID as the `aud`. (That ID is
 * the Chrome Web Store item ID, assigned at draft creation.)
 */
export const GOOGLE_OAUTH_CLIENT_ID: string =
  "776606808148-8p8l20pg1vt4jcbde2rr1orvlku87b55.apps.googleusercontent.com";

/** OAuth scopes for the profile-only sign-in (no Sheets/Drive scopes — the
 * service-account share model means we never touch Google APIs client-side). */
export const GOOGLE_OAUTH_SCOPES = ["openid", "email", "profile"] as const;

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** The path component handed to `chrome.identity.getRedirectURL()`. */
export const OAUTH_REDIRECT_PATH = "oauth2";

/**
 * ⚠️ UNVERIFIED — which Google response type this client will actually honour.
 *
 * `"id_token"` (the default) runs the OpenID Connect **implicit** flow:
 * `response_type=id_token` + a nonce, ID token comes back in the URL fragment,
 * no secret and no server round trip. That is what
 * `POST /v1/auth/google` wants — it takes a Google ID token as `credential` —
 * so it is the path with the fewest moving parts, and it is what ships.
 *
 * The risk: Google has been progressively restricting the implicit grant for
 * Web-application clients. If this client has it disabled, the consent screen
 * refuses with `unsupported_response_type` / `invalid_request` and NO id_token
 * ever reaches us. **Nobody has run this flow interactively yet** — it cannot
 * be exercised from a headless test, so treat "implicit works" as an
 * assumption until a human signs in once and confirms.
 *
 * `"code"` selects the fallback: authorization code + PKCE, with the code
 * exchanged **by the backend** (a Web-application client still needs its
 * secret at the token endpoint, so the extension cannot complete it alone).
 *
 * ── When to switch ────────────────────────────────────────────────────────
 * Switch to `"code"` if, and only if, an interactive sign-in fails with
 * `unsupported_response_type`, `invalid_request` naming `response_type`, or
 * the consent screen refuses to render at all.
 *
 * TODO(backend): the `"code"` path is NOT usable until sellerconnect's
 * `POST /v1/auth/google` also accepts `{ code, code_verifier, redirect_uri }`
 * and performs the token exchange server-side. As of 2026-08-10 it accepts
 * only `{ credential }`, so flipping this flag today trades one broken flow
 * for another — it exists so the client half is written, reviewed and ready,
 * not because it is live.
 */
export const GOOGLE_RESPONSE_TYPE: "id_token" | "code" = "id_token";
