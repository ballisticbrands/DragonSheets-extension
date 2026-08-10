/**
 * Pure helpers for the Google OAuth round trip: nonce minting, pulling the
 * ID token out of the redirect URL's **fragment**, and checking the claims we
 * can check client-side.
 *
 * Deliberately dependency-free (no `chrome.*`, no `fetch`) so the unit harness
 * can exercise every branch — see test/unit.harness.ts. The security-critical
 * work is NOT here: the ID token's *signature* is verified server-side by
 * `POST /v1/auth/google` (google-auth-library, against Google's rotating
 * JWKS). Everything below is a client-side sanity gate whose only job is to
 * fail fast and to prove the response belongs to the request we just made.
 *
 * Why the nonce matters even though the server re-verifies: without it, a
 * token minted for a *different* session of the same client ID would sail
 * through both our check and Google's. The nonce is the only thing binding
 * "this token" to "the launchWebAuthFlow call I just started".
 */

/** Claims we care about out of a Google ID token. */
export interface IdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
  exp?: number;
  iat?: number;
}

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

/** Clock skew we tolerate on `exp`. Google's own libraries allow the same. */
const CLOCK_SKEW_SECONDS = 300;

/**
 * 256 bits of CSPRNG, base64url-encoded. `crypto.getRandomValues` exists in
 * every context this runs in (MV3 service worker, extension page) and is the
 * only acceptable source — `Math.random()` would make the nonce forgeable and
 * therefore pointless.
 */
export function mintNonce(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a base64url segment to a UTF-8 string. Throws on malformed input. */
export function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Pull a value out of the **fragment** of the redirect URL.
 *
 * `response_type=id_token` (and `token`) put the result after the `#`, never
 * in the query string. Reading `searchParams` here is the classic mistake and
 * yields `null` forever, so the fragment is parsed explicitly. Google has also
 * been known to answer with `#error=…`, which is why `oauthErrorFromFragment`
 * exists alongside it — an error in the fragment must not be reported as
 * "no token in response".
 */
export function fragmentParams(resultUrl: string): URLSearchParams {
  const hash = resultUrl.includes("#") ? resultUrl.slice(resultUrl.indexOf("#") + 1) : "";
  return new URLSearchParams(hash);
}

/** Query-string params — the auth-code (PKCE) fallback answers here instead. */
export function queryParams(resultUrl: string): URLSearchParams {
  const q = resultUrl.indexOf("?");
  if (q === -1) return new URLSearchParams();
  const end = resultUrl.indexOf("#");
  return new URLSearchParams(resultUrl.slice(q + 1, end === -1 ? undefined : end));
}

export function idTokenFromFragment(resultUrl: string): string | null {
  return fragmentParams(resultUrl).get("id_token");
}

/**
 * Google reports refusals as `error` / `error_description`, in the fragment
 * for implicit responses and in the query string for code responses. Returns a
 * human sentence, or null when there is no error.
 */
export function oauthErrorFromResultUrl(resultUrl: string): string | null {
  for (const params of [fragmentParams(resultUrl), queryParams(resultUrl)]) {
    const err = params.get("error");
    if (err) {
      const desc = params.get("error_description");
      return desc ? `${err}: ${desc.replace(/\+/g, " ")}` : err;
    }
  }
  return null;
}

/** Decode a JWT's payload. Returns null for anything that is not a 3-part JWT. */
export function decodeIdToken(jwt: string): IdTokenClaims | null {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(parts[1])) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as IdTokenClaims;
  } catch {
    return null;
  }
}

export type IdTokenVerification =
  | { ok: true; claims: IdTokenClaims }
  | { ok: false; error: string };

/**
 * Client-side claim check. Order matters: the nonce is checked first because
 * a nonce mismatch is the one failure that means "this token is not an answer
 * to my request", and it should never be masked by a softer complaint.
 */
export function verifyIdToken(opts: {
  idToken: string;
  expectedNonce: string;
  clientId: string;
  /** ms epoch; injectable so the harness can test expiry deterministically. */
  now?: number;
}): IdTokenVerification {
  const claims = decodeIdToken(opts.idToken);
  if (!claims) return { ok: false, error: "Google returned a malformed ID token." };

  if (!opts.expectedNonce) {
    return { ok: false, error: "Sign-in state was lost before Google replied. Please try again." };
  }
  if (claims.nonce !== opts.expectedNonce) {
    return {
      ok: false,
      error: "Google's reply did not match this sign-in attempt. Please try again.",
    };
  }
  if (claims.aud !== opts.clientId) {
    return { ok: false, error: "Google's reply was issued for a different application." };
  }
  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) {
    return { ok: false, error: "Google's reply came from an unexpected issuer." };
  }
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < nowSec) {
    return { ok: false, error: "Google's reply has already expired. Please try again." };
  }
  if (!claims.email) {
    return { ok: false, error: "Google's reply carried no email address." };
  }
  return { ok: true, claims };
}

// ---------- PKCE (fallback path only — see ./real.ts) ----------

/** RFC 7636 code verifier: 43–128 chars of unreserved characters. */
export function mintCodeVerifier(): string {
  return mintNonce(64).slice(0, 96);
}

/** S256 challenge. Async because SubtleCrypto is. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}
