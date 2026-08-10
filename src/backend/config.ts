/**
 * Endpoints and origins the real backend path uses.
 *
 * Kept in one file so the manifest's `host_permissions` /
 * `externally_connectable` / CSP `connect-src` entries have exactly one place
 * to be checked against. Changing a value here without changing
 * public/manifest.json produces a runtime failure that is invisible until a
 * real user hits it.
 */

/** REST base. Registered in host_permissions and in the CSP connect-src. */
export const API_BASE_URL = "https://api.getdragonbot.com";

/** Static site (post-install page, privacy policy, OAuth bounce). */
export const SITE_ORIGIN = "https://go.getdragonsheets.com";

/**
 * `return_to` posted to the two `/v1/connect/…/start` endpoints.
 *
 * ⚠️ It must be the brand's `frontendBaseUrl` **exactly** — sellerconnect's
 * `brandForFrontendUrl()` is an exact-match lookup (src/lib/brand.ts), so
 * `${SITE_ORIGIN}/oauth-complete/` is silently REFUSED and falls back to the
 * Origin-derived brand. Sending the bare origin is therefore both the
 * documented value and the only one that survives validation; the backend
 * chooses the path it appends when it bounces the popup back.
 */
export const OAUTH_RETURN_TO = SITE_ORIGIN;

/** Where the backend is expected to land the consent popup (docs/EXTENSION_API.md). */
export const OAUTH_COMPLETE_URL = `${SITE_ORIGIN}/oauth-complete/`;
