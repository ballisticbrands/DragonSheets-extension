/**
 * Auth facade for the sidebar app. Two modes:
 *
 *  - "mock" (default): "Sign in with Google" resolves instantly to a fake
 *    profile via MockBackend.
 *  - "real": asks the service worker to run the whole exchange —
 *    chrome.identity.launchWebAuthFlow (the identity API is unavailable in
 *    content scripts) → Google ID token → POST /v1/auth/google → store the
 *    `sc_live_…` bearer. The sidebar then reads the session back through the
 *    BackendClient. Build with VITE_AUTH_MODE=real VITE_BACKEND=real.
 *
 * Why the SW does the exchange rather than handing the ID token back: the
 * bearer must never enter a content script that shares a page with
 * docs.google.com, and only the SW holds `host_permissions` for the API.
 */
import { getBackend } from "../backend";
import type { Session } from "../backend/types";
import { MSG, type AuthSignInResponse } from "../lib/messages";

export type AuthMode = "mock" | "real";

export function getAuthMode(): AuthMode {
  return import.meta.env.VITE_AUTH_MODE === "real" ? "real" : "mock";
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
