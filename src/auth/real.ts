/**
 * Real Google sign-in via chrome.identity.launchWebAuthFlow.
 *
 * IMPORTANT: chrome.identity is NOT available to content scripts, so this
 * module only runs inside the service worker; the sidebar reaches it with a
 * `MSG.authGoogleSignIn` message (see src/auth/index.ts).
 *
 * Wired but dormant: GOOGLE_OAUTH_CLIENT_ID is currently null (see
 * ./config.ts TODO(user-task)), so this path returns a clear error until the
 * GCP OAuth client exists.
 */
import { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_SCOPES } from "./config";
import type { AuthSignInResponse, GoogleProfile } from "../lib/messages";

export async function handleGoogleSignIn(): Promise<AuthSignInResponse> {
  if (!GOOGLE_OAUTH_CLIENT_ID) {
    return {
      ok: false,
      error:
        "Real Google sign-in is not configured: GOOGLE_OAUTH_CLIENT_ID is null (see src/auth/config.ts TODO(user-task)).",
    };
  }
  try {
    const redirectUri = chrome.identity.getRedirectURL("oauth2");
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "token");
    authUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    authUrl.searchParams.set("prompt", "select_account");

    const resultUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });
    if (!resultUrl) return { ok: false, error: "Sign-in was cancelled." };

    // Token arrives in the URL fragment: #access_token=...&expires_in=...
    const fragment = new URLSearchParams(new URL(resultUrl).hash.slice(1));
    const accessToken = fragment.get("access_token");
    if (!accessToken) return { ok: false, error: "No access token in OAuth response." };

    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { ok: false, error: `userinfo failed: HTTP ${res.status}` };
    const info = (await res.json()) as { email?: string; name?: string; picture?: string };
    if (!info.email) return { ok: false, error: "userinfo response had no email." };

    const profile: GoogleProfile = {
      email: info.email,
      name: info.name ?? info.email,
      picture: info.picture,
    };
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
