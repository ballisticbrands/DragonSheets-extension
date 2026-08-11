/**
 * Auth facade for the sidebar app. Two modes:
 *
 *  - "mock" (default): "Sign in with Google" resolves instantly to a fake
 *    profile via MockBackend.
 *  - "real": asks the service worker to run the whole exchange —
 *    chrome.identity.launchWebAuthFlow (the identity API is unavailable in
 *    content scripts) → Google ID token → POST /v1/auth/google → store the
 *    `sc_live_…` bearer. The sidebar then reads the session back through the
 *    BackendClient.
 *
 * **Auth mode follows the backend mode.** `VITE_BACKEND=real` alone is enough.
 * Real-backend-with-mock-auth is not a configuration anyone wants: mock auth
 * never obtains a token, so every real call is unauthenticated and the first
 * symptom is a baffling "signed in, but the session didn't stick" — which is
 * exactly what it did on the first live attempt (2026-08-11), because the
 * build command set only VITE_BACKEND. Deriving the default removes the
 * footgun; VITE_AUTH_MODE still overrides explicitly, in either direction.
 *
 * Why the SW does the exchange rather than handing the ID token back: the
 * bearer must never enter a content script that shares a page with
 * docs.google.com, and only the SW holds `host_permissions` for the API.
 */
import { getBackend, getBackendMode } from "../backend";
import type { Session } from "../backend/types";
import { MSG, type AuthSignInResponse } from "../lib/messages";

export type AuthMode = "mock" | "real";

/**
 * Pure decision, split out so it is testable without rebuilding the bundle
 * (`import.meta.env` is inlined at build time).
 *
 * `undefined` explicit ⇒ follow the backend, because real-backend-with-
 * mock-auth is always broken; see the note at the top of this file.
 */
export function resolveAuthMode(
  explicit: string | undefined,
  backendMode: "mock" | "real",
): AuthMode {
  if (explicit === "real") return "real";
  if (explicit === "mock") return "mock";
  return backendMode === "real" ? "real" : "mock";
}

export function getAuthMode(): AuthMode {
  return resolveAuthMode(import.meta.env.VITE_AUTH_MODE, getBackendMode());
}

export async function signInWithGoogle(): Promise<Session> {
  const backend = getBackend();
  if (getAuthMode() === "mock") {
    return backend.googleSignIn();
  }
  const res = (await chrome.runtime.sendMessage({
    type: MSG.authGoogleSignIn,
  })) as AuthSignInResponse | undefined;
  if (!res?.ok) {
    throw new Error(res?.error ?? "Google sign-in failed.");
  }
  // The session token is already stored by the SW; `googleSignIn` on the real
  // client just reads /v1/auth/me back. The profile is passed along because
  // MockBackend still uses it (and because a future client may want the
  // avatar, which /v1/auth/me does not return).
  return backend.googleSignIn(res.profile);
}
