/**
 * The service worker's HTTP layer for api.getdragonbot.com.
 *
 * This module runs **only in the service worker**. The sidebar reaches it by
 * posting `MSG.apiRequest`; it never calls `fetch` itself, for two reasons:
 *
 *  1. `host_permissions` are the extension's, not the host page's. A
 *     content-script `fetch` runs in docs.google.com's CORS context, so the
 *     call would be blocked (or, worse, silently answered by an opaque
 *     response).
 *  2. The `sc_live_…` bearer stays out of a script that shares a JS realm
 *     boundary with a Google-owned page.
 *
 * Error contract (docs/EXTENSION_API.md): a failure is
 * `{ error: "human sentence", error_code: "snake_case" }` with a real status.
 * `error` is written for a seller, so it is surfaced verbatim; we only invent
 * a sentence when the backend didn't send one (network drop, HTML error page
 * from a proxy, …).
 */
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from "../lib/storage";
import type { ApiMethod, ApiResponseMessage } from "../lib/messages";
import { API_BASE_URL } from "./config";

export interface StoredAuthToken {
  token: string;
  /** ms epoch, derived from the `expires_in` the backend returned. */
  expiresAt: number;
}

export async function readAuthToken(): Promise<StoredAuthToken | null> {
  const stored = await storageGet<StoredAuthToken>(STORAGE_KEYS.authToken);
  if (!stored || typeof stored.token !== "string" || !stored.token) return null;
  // A token past its stated life is worse than no token: every call 401s and
  // the UI reads as "broken" rather than "signed out". Drop it and let the
  // sidebar route back to Welcome.
  if (typeof stored.expiresAt === "number" && stored.expiresAt <= Date.now()) {
    await storageRemove(STORAGE_KEYS.authToken);
    return null;
  }
  return stored;
}

export async function writeAuthToken(token: string, expiresInSeconds: number): Promise<void> {
  const ttl = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 0;
  await storageSet(STORAGE_KEYS.authToken, {
    token,
    // 0 ⇒ "unknown lifetime": store a far-future stamp rather than an
    // immediately-expired one, and let the server's 401 be the authority.
    expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : Number.MAX_SAFE_INTEGER,
  } satisfies StoredAuthToken);
}

export async function clearAuthToken(): Promise<void> {
  await storageRemove(STORAGE_KEYS.authToken);
}

/** Network timeout. A hung sidebar spinner is the worst failure mode here. */
const REQUEST_TIMEOUT_MS = 20_000;

export async function apiFetch<T = unknown>(opts: {
  method: ApiMethod;
  path: string;
  body?: unknown;
  /** Omit the Authorization header — only POST /v1/auth/google wants this. */
  anonymous?: boolean;
}): Promise<ApiResponseMessage<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  if (!opts.anonymous) {
    const stored = await readAuthToken();
    if (!stored) {
      return {
        ok: false,
        status: 401,
        error: "You're signed out. Sign in with Google to continue.",
        errorCode: "not_signed_in",
      };
    }
    headers.Authorization = `Bearer ${stored.token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      // The API is cookie-free by design (CORS stays credentials:false).
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      error: aborted
        ? "DragonSheets couldn't reach the server in time. Check your connection and try again."
        : "DragonSheets couldn't reach the server. Check your connection and try again.",
      errorCode: aborted ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }

  // 204 and friends carry no body; JSON.parse("") would throw.
  const raw = await res.text().catch(() => "");
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }

  if (!res.ok) {
    const errBody = (parsed ?? {}) as { error?: unknown; error_code?: unknown };
    // 401 means the token is dead — drop it so the next mount shows Welcome
    // rather than looping on an error banner.
    if (res.status === 401) await clearAuthToken();
    return {
      ok: false,
      status: res.status,
      error:
        typeof errBody.error === "string" && errBody.error
          ? errBody.error
          : `The server returned an error (HTTP ${res.status}).`,
      errorCode: typeof errBody.error_code === "string" ? errBody.error_code : undefined,
    };
  }

  return { ok: true, status: res.status, data: parsed as T };
}
