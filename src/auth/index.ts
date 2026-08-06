/**
 * Auth facade for the sidebar app. Two modes:
 *
 *  - "mock" (default): "Sign in with Google" resolves instantly to a fake
 *    profile via MockBackend.
 *  - "real" (wired but dormant): asks the service worker to run
 *    chrome.identity.launchWebAuthFlow (identity API is unavailable in
 *    content scripts), then hands the Google profile to the backend to mint a
 *    session. Requires GOOGLE_OAUTH_CLIENT_ID (src/auth/config.ts) and a
 *    VITE_AUTH_MODE=real build.
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
  if (!res?.ok || !res.profile) {
    throw new Error(res?.error ?? "Google sign-in failed.");
  }
  // Phase 8: the real backend exchanges the Google identity for an sc_*
  // session server-side. Until then the profile seeds the (mock) session.
  return backend.googleSignIn(res.profile);
}
