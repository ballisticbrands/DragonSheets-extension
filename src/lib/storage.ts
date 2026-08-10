/**
 * Promisified chrome.storage.local with an explicit operation timeout
 * (hopted-teardown §4.3: they wrap every storage op in a 4s timeout because
 * chrome.storage hangs in the wild — copy the defensive pattern).
 */
const OP_TIMEOUT_MS = 4000;

export const STORAGE_KEYS = {
  /** Remote selector-map override cached by the service worker. */
  selectorMap: "ds:selector-map",
  /** When the bootstrap.json was last fetched (ms epoch). */
  bootstrapFetchedAt: "ds:bootstrap-fetched-at",
  /** MockBackend persisted state. */
  mockState: "ds:mock-state",
  /** Attribution blob delivered by go.getdragonsheets.com via externally_connectable. */
  attribution: "ds:attribution",

  // ---------- real auth (src/auth/*, src/backend/real.ts) ----------
  /**
   * `{ token, expiresAt }` — the `sc_live_…` bearer minted by
   * POST /v1/auth/google. Written and read ONLY by the service worker; the
   * sidebar never sees it (it relays calls through MSG.apiRequest instead),
   * which keeps the token out of the docs.google.com-hosted content script.
   */
  authToken: "ds:auth-token",
  /**
   * `{ nonce, verifier?, createdAt }` — the single-use OAuth nonce (and, on
   * the PKCE fallback path, the code verifier). Written just before
   * launchWebAuthFlow and consumed the moment the ID token comes back.
   */
  authOauthState: "ds:auth-oauth-state",
  /** Last `ds-oauth-result` the bounce page delivered — diagnostics only. */
  lastOauthResult: "ds:last-oauth-result",

  // ---------- analytics (src/analytics/*) ----------
  /** `{ id, source }` — the GA4 client_id and where it came from ("bridge" | "minted"). */
  gaClientId: "ds:ga-client-id",
  /** `{ id, startedAt, lastEventAt }` — rolling 30-minute GA4 session. */
  gaSession: "ds:ga-session",
  /** FIFO array of un-sent Measurement Protocol envelopes (capped). */
  gaQueue: "ds:ga-queue",
  /** `true` once ANY event has been accepted by GA4 under the current client_id. */
  gaSentAny: "ds:ga-sent-any",
  /** `true` once `sign_up` has fired. It fires exactly once, ever. */
  gaSignupLogged: "ds:ga-signup-logged",
  /** `true` once the full attribution blob has been attached to an event. */
  gaAttributionAttached: "ds:ga-attribution-attached",
  /** Opaque user id set at sign-in; sent as MP `user_id`. Never PII. */
  gaUserId: "ds:ga-user-id",
  /**
   * Connection ids this install has already fired an activation for.
   * Deliberately named to mirror frontend-shared's `dragonbot_activations_v1`
   * localStorage key — identical shape (a string array), own namespace.
   */
  activations: "dragonsheets_activations_v1",
  /** "bridge" | "direct" — how this install's attribution was obtained. */
  attributionSource: "ds:attribution-source",
} as const;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`chrome.storage op timed out: ${label}`)),
      OP_TIMEOUT_MS
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

export async function storageGet<T>(key: string): Promise<T | undefined> {
  const res = await withTimeout(chrome.storage.local.get(key), `get ${key}`);
  return res[key] as T | undefined;
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  await withTimeout(chrome.storage.local.set({ [key]: value }), `set ${key}`);
}

export async function storageRemove(key: string): Promise<void> {
  await withTimeout(chrome.storage.local.remove(key), `remove ${key}`);
}
