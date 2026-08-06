/**
 * GA4 Measurement Protocol configuration.
 *
 * ⚠️ Why the Measurement Protocol and not gtag.js
 * ------------------------------------------------
 * MV3 forbids remote code. `https://www.googletagmanager.com/gtag/js` is
 * remote code, so it can neither be loaded in an extension page nor injected
 * from the service worker — Chrome Web Store review rejects it and the
 * extension_pages CSP blocks it at runtime. Google's documented alternative
 * for extensions is the **Measurement Protocol**: a plain HTTPS POST carrying
 * a `measurement_id` + `api_secret`, which we send from the service worker
 * (see ./mp.ts). Same GA4 property as the landing page, so the LP session and
 * the in-extension session stitch into one user via a shared `client_id`
 * (see ./client-id.ts).
 *
 * The landing page and go.getdragonsheets.com keep the normal gtag/Clarity/
 * Meta stack — they are ordinary web pages. Only the extension is different.
 */

/**
 * GA4 web-stream measurement ID, e.g. "G-XXXXXXXXXX".
 *
 * TODO(user-task): fill from DRAGONSHEETS_USER_TASKS.md **Task 4a** step 3
 * (Google Analytics → Admin → Data Streams → the getdragonsheets.com web
 * stream). The SAME id the landing page's gtag snippet uses — one property,
 * two collection paths.
 */
export const GA4_MEASUREMENT_ID: string | null = null;

/**
 * Measurement Protocol API secret for that stream.
 *
 * TODO(user-task): fill from DRAGONSHEETS_USER_TASKS.md **Task 4a** step 6
 * (Data Streams → the stream → *Measurement Protocol API secrets* → Create →
 * name it "extension"). This is a write-only credential: it can send events
 * to the property, it cannot read anything. It ships inside the extension
 * bundle, which is public — that is expected and is why Google scopes it the
 * way it does. Rotate it from the same screen if it is ever abused.
 */
export const GA4_API_SECRET: string | null = null;

/**
 * When true, events go to GA4's **validation** endpoint
 * (`/debug/mp/collect`) instead of `/mp/collect`.
 *
 * The validation endpoint does NOT record the event — it returns a JSON body
 * with a `validationMessages` array explaining exactly why a payload would be
 * dropped. `/mp/collect` always answers `204 No Content` even for a payload it
 * silently discards, so this toggle is the only way to debug a malformed
 * event. Flip it to `true` locally, reload the extension, watch the service
 * worker console — then flip it back. Never ship `true`.
 *
 * See docs/ANALYTICS.md → "Verifying in GA4".
 */
export const DEBUG_ENDPOINT = false;

/** Base host for both endpoints. */
export const GA4_HOST = "https://www.google-analytics.com";

/**
 * Test seam. The two constants above are `null` in every shipped build until
 * the user fills them, which would make the offline-queue path the ONLY path
 * the harness could ever exercise. `test/analytics.harness.ts` calls this to
 * supply throwaway credentials so the real send path is testable.
 * Production code must never call it.
 */
let override: { measurementId: string; apiSecret: string } | null = null;

export function __setCredentialsForTest(
  next: { measurementId: string; apiSecret: string } | null
): void {
  override = next;
}

function measurementId(): string | null {
  return override?.measurementId ?? GA4_MEASUREMENT_ID;
}

function apiSecret(): string | null {
  return override?.apiSecret ?? GA4_API_SECRET;
}

/** True when both credentials are present; ./mp.ts no-ops (and queues) otherwise. */
export function isAnalyticsConfigured(): boolean {
  return Boolean(measurementId()) && Boolean(apiSecret());
}

/** The full collect URL, or null when unconfigured. */
export function collectUrl(): string | null {
  if (!isAnalyticsConfigured()) return null;
  const path = DEBUG_ENDPOINT ? "/debug/mp/collect" : "/mp/collect";
  return (
    `${GA4_HOST}${path}` +
    `?measurement_id=${encodeURIComponent(measurementId() as string)}` +
    `&api_secret=${encodeURIComponent(apiSecret() as string)}`
  );
}

// ---------- protocol limits (GA4 enforces these silently) ----------

/** Max events per request. We send one at a time, but the queue flush respects it. */
export const MAX_EVENTS_PER_REQUEST = 25;
/** Max characters in an event-parameter value. Longer values are truncated. */
export const MAX_PARAM_VALUE_CHARS = 100;
/** Max characters in a USER-property value. Much shorter than the param limit. */
export const MAX_USER_PROPERTY_VALUE_CHARS = 36;
/** Max un-sent envelopes held in chrome.storage.local before we evict. */
export const MAX_QUEUE_LENGTH = 50;
