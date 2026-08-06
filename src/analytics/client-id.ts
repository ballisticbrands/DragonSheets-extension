/**
 * The GA4 `client_id` — the single field that decides whether a Google Ads
 * click and an in-extension conversion are the same human being.
 *
 * ## The problem this solves
 *
 * A visitor clicks an ad → lands on getdragonsheets.com → gtag.js mints a
 * client_id and stores it in the `_ga` cookie → they click "Add to Chrome" →
 * **the Chrome Web Store**. The store strips every query param, runs on
 * google.com, and hands the extension no referrer, no gclid, no cookies. A
 * freshly installed extension that mints its own client_id is, to GA4, a
 * brand-new anonymous user, and the `connect_amazon` conversion it later
 * reports can never be attributed back to the ad click.
 *
 * The fix is the bridge page (site/installed/index.html): it runs on
 * go.getdragonsheets.com, which shares eTLD+1 with the landing page, so it can
 * read the `_ga` cookie, extract the LP's client_id, and hand it to the
 * extension over externally_connectable messaging. We then adopt it as our
 * own — and the whole journey becomes one GA4 user.
 *
 * ## Precedence (bridge > existing > new)
 *
 *  1. **Bridge** — a client_id delivered by /installed/ wins, but only while
 *     we have not yet had an event accepted by GA4. Adopting a new client_id
 *     after we have already reported events under a different one would split
 *     one user into two and orphan the earlier events, so past that point the
 *     existing id is frozen and the bridge id is recorded for diagnostics
 *     only.
 *  2. **Existing** — whatever is already in chrome.storage.local. Stable for
 *     the life of the install; never re-minted.
 *  3. **New** — mint one in GA4's own format: `<random uint32>.<epoch
 *     seconds>`, e.g. `1739468182.1754438400`. Matching the format matters:
 *     GA4 treats the client_id as an opaque string, but the format is what
 *     every debugging tool, the `_ga` cookie and Google's own samples expect.
 */
import { logDiag } from "../lib/diagnostics";
import { STORAGE_KEYS, storageGet, storageSet } from "../lib/storage";

export type ClientIdSource = "bridge" | "minted";

export interface ClientIdRecord {
  id: string;
  source: ClientIdSource;
  /** ms epoch when this id was adopted/minted. */
  at: number;
  /**
   * Set when a bridge client_id arrived too late to adopt (we had already
   * reported events). Kept so DebugView mismatches are explainable.
   */
  rejectedBridgeId?: string;
}

/** GA4's client_id shape: `<random uint32>.<epoch seconds>`. */
export function mintClientId(): string {
  const random = Math.floor(Math.random() * 0xffffffff);
  const seconds = Math.floor(Date.now() / 1000);
  return `${random}.${seconds}`;
}

/**
 * A `_ga`-cookie-derived client_id looks like `1739468182.1754438400`.
 * Reject anything that does not, so a malformed bridge payload can never
 * poison the property with a junk id.
 */
export function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,10}\.\d{9,11}$/.test(value);
}

/**
 * Get the client_id for this install, minting one on first call.
 * Idempotent and safe to call from any context.
 */
export async function getClientId(): Promise<string> {
  const existing = await readRecord();
  if (existing) return existing.id;

  const record: ClientIdRecord = { id: mintClientId(), source: "minted", at: Date.now() };
  await storageSet(STORAGE_KEYS.gaClientId, record);
  logDiag("ga-client-id-minted", { source: record.source });
  return record.id;
}

/** The full record (id + provenance), or undefined before the first mint. */
export async function readRecord(): Promise<ClientIdRecord | undefined> {
  const raw = await storageGet<ClientIdRecord>(STORAGE_KEYS.gaClientId);
  return raw && isValidClientId(raw.id) ? raw : undefined;
}

/**
 * Adopt a client_id handed over by the attribution bridge.
 *
 * Returns what happened, so the service worker can log it:
 *  - "adopted"   — this is now our client_id (LP session successfully stitched)
 *  - "unchanged" — we already had this exact id
 *  - "rejected"  — we have already reported events under a different id
 *  - "invalid"   — the payload was not a GA4 client_id
 */
export async function adoptBridgeClientId(
  candidate: unknown
): Promise<"adopted" | "unchanged" | "rejected" | "invalid"> {
  if (!isValidClientId(candidate)) return "invalid";

  const existing = await readRecord();
  if (existing?.id === candidate) return "unchanged";

  // Freeze point: once GA4 has accepted an event under the current id,
  // switching would fork one user into two.
  const sentAny = (await storageGet<boolean>(STORAGE_KEYS.gaSentAny)) === true;
  if (existing && sentAny) {
    await storageSet(STORAGE_KEYS.gaClientId, {
      ...existing,
      rejectedBridgeId: candidate,
    } satisfies ClientIdRecord);
    logDiag("ga-client-id-bridge-rejected", { reason: "events-already-sent" });
    return "rejected";
  }

  await storageSet(STORAGE_KEYS.gaClientId, {
    id: candidate,
    source: "bridge",
    at: Date.now(),
  } satisfies ClientIdRecord);
  logDiag("ga-client-id-adopted", { source: "bridge" });
  return "adopted";
}

/** Marks that GA4 has accepted at least one event under the current id. */
export async function markEventSent(): Promise<void> {
  await storageSet(STORAGE_KEYS.gaSentAny, true);
}
