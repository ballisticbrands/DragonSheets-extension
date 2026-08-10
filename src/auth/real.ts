/**
 * Real Google sign-in.
 *
 * IMPORTANT: `chrome.identity` is NOT available to content scripts, so this
 * module only ever runs inside the service worker; the sidebar reaches it with
 * a `MSG.authGoogleSignIn` message (see src/auth/index.ts).
 *
 * The whole exchange happens here, in one hop, because every step needs
 * something only the service worker has:
 *
 *   1. `chrome.identity.launchWebAuthFlow` → Google consent      (identity API)
 *   2. ID token out of the redirect **fragment**, nonce-verified (ephemeral state)
 *   3. `POST /v1/auth/google { credential, attribution }`        (host_permissions)
 *   4. store the returned `sc_live_…` bearer                     (never leaves the SW)
 *
 * Step 3 carries the attribution blob the bridge page delivered at install
 * time. That is the only moment sellerconnect can record where a signup came
 * from — `parseAttribution()` reads `body.attribution` when it *creates* the
 * user row, and never looks again. Dropping it here loses the ad click that
 * paid for the install, permanently.
 *
 * ⚠️ See ./config.ts `GROUP GOOGLE_RESPONSE_TYPE` for the one genuine
 * uncertainty in this file: whether Google will honour the implicit
 * `response_type=id_token` grant for this client. It is implemented as
 * specced and has NOT been run interactively.
 */
import { readAttribution } from "../analytics/attribution";
import { apiFetch, writeAuthToken } from "../backend/http";
import { logDiag } from "../lib/diagnostics";
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from "../lib/storage";
import type { AuthSignInResponse, GoogleProfile } from "../lib/messages";
import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_SCOPES,
  GOOGLE_RESPONSE_TYPE,
  OAUTH_REDIRECT_PATH,
} from "./config";
import {
  codeChallengeS256,
  idTokenFromFragment,
  mintCodeVerifier,
  mintNonce,
  oauthErrorFromResultUrl,
  queryParams,
  verifyIdToken,
} from "./id-token";

interface OauthState {
  nonce: string;
  /** Present only on the PKCE fallback path. */
  verifier?: string;
  createdAt: number;
}

/** Anything older than this is a leftover from an abandoned attempt. */
const STATE_MAX_AGE_MS = 10 * 60_000;

async function putState(state: OauthState): Promise<void> {
  await storageSet(STORAGE_KEYS.authOauthState, state);
}

/** Read-and-delete: the nonce is single-use, so a replay finds nothing. */
async function takeState(): Promise<OauthState | null> {
  const state = await storageGet<OauthState>(STORAGE_KEYS.authOauthState);
  await storageRemove(STORAGE_KEYS.authOauthState);
  if (!state || typeof state.nonce !== "string" || !state.nonce) return null;
  if (Date.now() - (state.createdAt ?? 0) > STATE_MAX_AGE_MS) return null;
  return state;
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL(OAUTH_REDIRECT_PATH);
}

// ─── the flow ──────────────────────────────────────────────────────────────

export async function handleGoogleSignIn(): Promise<AuthSignInResponse> {
  try {
    const credential =
      GOOGLE_RESPONSE_TYPE === "code"
        ? await getCredentialViaAuthCode()
        : await getCredentialViaImplicit();
    if ("error" in credential) return { ok: false, error: credential.error };

    return await exchangeWithBackend(credential);
  } catch (err) {
    logDiag("auth-signin-threw", { error: String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type CredentialResult =
  | { error: string }
  | { kind: "id_token"; idToken: string; profile: GoogleProfile }
  | { kind: "code"; code: string; verifier: string; redirectUri: string };

/**
 * OpenID Connect implicit flow — the shipping path.
 *
 * `response_type=id_token` with `scope=openid email profile` and a
 * cryptographically random `nonce`. Google answers on the redirect URL's
 * FRAGMENT (`#id_token=…`), never the query string.
 */
async function getCredentialViaImplicit(): Promise<CredentialResult> {
  const nonce = mintNonce();
  await putState({ nonce, createdAt: Date.now() });

  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("prompt", "select_account");

  const resultUrl = await launch(url.toString());
  if (typeof resultUrl !== "string") return { error: resultUrl.error };

  const oauthError = oauthErrorFromResultUrl(resultUrl);
  if (oauthError) {
    // `unsupported_response_type` here is THE signal that this client has the
    // implicit grant disabled — see the switching criteria in ./config.ts.
    logDiag("auth-google-oauth-error", { error: oauthError });
    return { error: `Google refused the sign-in (${oauthError}).` };
  }

  const idToken = idTokenFromFragment(resultUrl);
  if (!idToken) {
    return {
      error:
        "Google's reply contained no ID token. If this keeps happening, the implicit sign-in flow may be disabled for this app (see src/auth/config.ts).",
    };
  }

  const state = await takeState();
  const verified = verifyIdToken({
    idToken,
    expectedNonce: state?.nonce ?? "",
    clientId: GOOGLE_OAUTH_CLIENT_ID,
  });
  if (!verified.ok) {
    logDiag("auth-google-idtoken-rejected", { error: verified.error });
    return { error: verified.error };
  }

  const claims = verified.claims;
  return {
    kind: "id_token",
    idToken,
    profile: {
      email: claims.email!,
      name: claims.name ?? claims.email!,
      picture: claims.picture,
    },
  };
}

/**
 * ⚠️ FALLBACK PATH — authorization code + PKCE, exchanged BY THE BACKEND.
 *
 * Dormant unless `GOOGLE_RESPONSE_TYPE === "code"` in ./config.ts, and NOT
 * usable until sellerconnect's `POST /v1/auth/google` learns to accept
 * `{ code, code_verifier, redirect_uri }`. It exists so that, if Google turns
 * out to refuse the implicit grant for this client, the extension half of the
 * fix is already written and reviewed rather than being invented under
 * pressure.
 *
 * Why the backend has to do the exchange: this is a Google **Web application**
 * client, and Google's token endpoint still demands `client_secret` for that
 * client type even with PKCE. A secret cannot live in an extension bundle —
 * it is world-readable in the CRX. So the extension gets the code, and
 * sellerconnect (which already holds the secret for the SPA flows) redeems it.
 */
async function getCredentialViaAuthCode(): Promise<CredentialResult> {
  const nonce = mintNonce();
  const verifier = mintCodeVerifier();
  await putState({ nonce, verifier, createdAt: Date.now() });

  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", await codeChallengeS256(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");

  const resultUrl = await launch(url.toString());
  if (typeof resultUrl !== "string") return { error: resultUrl.error };

  const oauthError = oauthErrorFromResultUrl(resultUrl);
  if (oauthError) return { error: `Google refused the sign-in (${oauthError}).` };

  const code = queryParams(resultUrl).get("code");
  if (!code) return { error: "Google's reply contained no authorization code." };

  const state = await takeState();
  if (!state?.verifier) {
    return { error: "Sign-in state was lost before Google replied. Please try again." };
  }
  return { kind: "code", code, verifier: state.verifier, redirectUri: redirectUri() };
}

async function launch(url: string): Promise<string | { error: string }> {
  const resultUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!resultUrl) {
    // Chrome also lands here when the user closes the consent window.
    return { error: "Sign-in was cancelled." };
  }
  return resultUrl;
}

// ─── backend exchange ──────────────────────────────────────────────────────

interface AuthGoogleResponse {
  token?: string;
  expires_in?: number;
}

/**
 * POST the Google credential to sellerconnect and keep the `sc_live_…` bearer
 * it mints. That bearer is the Authorization header on every later call.
 */
async function exchangeWithBackend(
  credential: Extract<CredentialResult, { kind: string }>
): Promise<AuthSignInResponse> {
  const attribution = await readAttribution().catch(() => ({}));

  const body =
    credential.kind === "id_token"
      ? { credential: credential.idToken, attribution }
      : // Fallback shape — see getCredentialViaAuthCode()'s TODO(backend).
        {
          code: credential.code,
          code_verifier: credential.verifier,
          redirect_uri: credential.redirectUri,
          attribution,
        };

  const res = await apiFetch<AuthGoogleResponse>({
    method: "POST",
    path: "/v1/auth/google",
    body,
    anonymous: true, // the one endpoint that takes no Bearer
  });

  if (!res.ok || !res.data?.token) {
    logDiag("auth-exchange-failed", { status: res.status, code: res.errorCode });
    return {
      ok: false,
      // The backend writes `error` for a seller; surface it verbatim.
      error: res.error ?? "Sign-in failed. Please try again.",
    };
  }

  await writeAuthToken(res.data.token, res.data.expires_in ?? 0);
  logDiag("auth-signed-in", { status: res.status });

  return {
    ok: true,
    profile: credential.kind === "id_token" ? credential.profile : undefined,
  };
}
