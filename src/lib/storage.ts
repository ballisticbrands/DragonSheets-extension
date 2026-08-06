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
