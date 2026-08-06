/**
 * GA4 Measurement Protocol transport.
 *
 * Runs in the **service worker** only. Content scripts must not call this
 * directly: a `fetch()` from a content script is issued in the host page's
 * CORS context (docs.google.com), so it would be blocked. ./track.ts relays
 * UI-side events to the service worker over chrome.runtime messaging; the
 * service worker then calls sendEvent() here.
 *
 * Contract, in order of importance:
 *
 *  1. **Never throws into a caller.** Analytics failing must not break the
 *     product. Every path returns a result object.
 *  2. **No PII, ever.** GA4's terms prohibit it and, unlike the web surfaces,
 *     there is no Clarity here to receive email/name instead — so the PII
 *     boundary in frontend-shared's `identifyUserAcrossPlatforms` collapses to
 *     a flat rule: nothing identifying leaves this file. `user_id` is an
 *     opaque backend id and is the only user-scoped value we send.
 *  3. **Every event carries `session_id` + `engagement_time_msec`.** See
 *     ./session.ts for why omitting them silently deletes your data.
 *  4. **Unconfigured or offline ⇒ queue, don't crash.** Dev builds have null
 *     credentials; laptops go offline. Events land in a capped FIFO in
 *     chrome.storage.local and flush, in order, on the next successful send.
 */
import { logDiag } from "../lib/diagnostics";
import { STORAGE_KEYS, storageGet, storageSet } from "../lib/storage";
import {
  MAX_PARAM_VALUE_CHARS,
  MAX_QUEUE_LENGTH,
  MAX_USER_PROPERTY_VALUE_CHARS,
  collectUrl,
  isAnalyticsConfigured,
  DEBUG_ENDPOINT,
} from "./config";
import { getClientId, markEventSent } from "./client-id";
import { touchSession } from "./session";

export type ParamValue = string | number | boolean;
export type EventParams = Record<string, ParamValue | null | undefined>;

export interface SendOptions {
  /** Opaque backend user id. Never an email. */
  userId?: string;
  /** GA4 user properties. Values are truncated to 36 chars (GA4's limit). */
  userProperties?: Record<string, ParamValue | null | undefined>;
}

export interface SendResult {
  ok: boolean;
  /** "sent" | "queued" | "unconfigured" | "error" */
  status: "sent" | "queued" | "unconfigured" | "error";
  queued: number;
  error?: string;
}

/** One event, frozen at the moment it was raised (session fields included). */
export interface QueuedEnvelope {
  name: string;
  params: Record<string, ParamValue>;
  userId?: string;
  userProperties?: Record<string, { value: ParamValue }>;
  /** ms epoch when raised — replayed as `timestamp_micros` so late flushes keep their real time. */
  raisedAt: number;
}

// ---------- PII scrubbing ----------

/**
 * Parameter names that must never reach GA4. An explicit denylist, not a
 * regex on "name" — plenty of legitimate params are `sheet_name`,
 * `report_name`, `sync_name`, and a fuzzy match would silently eat them.
 */
const PII_KEYS = new Set([
  "email",
  "e_mail",
  "mail",
  "user_email",
  "email_address",
  "name",
  "full_name",
  "first_name",
  "last_name",
  "given_name",
  "family_name",
  "display_name",
  "user_name",
  "username",
  "phone",
  "phone_number",
  "address",
  "street",
  "postcode",
  "zip",
  "picture",
  "avatar",
  "avatar_url",
  "ip",
  "ip_address",
  "profile",
]);

/** Belt-and-braces: an email-shaped VALUE is dropped whatever its key is called. */
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function isPiiKey(key: string): boolean {
  return PII_KEYS.has(key.toLowerCase());
}

function scrub(
  input: Record<string, ParamValue | null | undefined> | undefined,
  maxChars: number
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  if (!input) return out;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const key = rawKey.slice(0, 40); // GA4 param-name limit
    if (isPiiKey(key)) {
      logDiag("ga-pii-param-dropped", { key });
      continue;
    }
    if (typeof rawValue === "string") {
      if (EMAIL_VALUE.test(rawValue)) {
        logDiag("ga-pii-value-dropped", { key });
        continue;
      }
      out[key] = rawValue.slice(0, maxChars);
    } else {
      out[key] = rawValue;
    }
  }
  return out;
}

// ---------- queue ----------

async function readQueue(): Promise<QueuedEnvelope[]> {
  const raw = await storageGet<QueuedEnvelope[]>(STORAGE_KEYS.gaQueue);
  return Array.isArray(raw) ? raw : [];
}

async function writeQueue(q: QueuedEnvelope[]): Promise<void> {
  await storageSet(STORAGE_KEYS.gaQueue, q);
}

/**
 * Append, evicting the OLDEST entries past the cap. A ring buffer, not a
 * hard stop: an install that has been offline for a week must still be able
 * to report today's conversion.
 */
async function enqueue(env: QueuedEnvelope): Promise<number> {
  const q = await readQueue();
  q.push(env);
  const dropped = Math.max(0, q.length - MAX_QUEUE_LENGTH);
  const trimmed = dropped > 0 ? q.slice(dropped) : q;
  if (dropped > 0) logDiag("ga-queue-evicted", { dropped, cap: MAX_QUEUE_LENGTH });
  await writeQueue(trimmed);
  return trimmed.length;
}

// ---------- transport ----------

/** One warn per service-worker lifetime — not one per event. */
let warnedUnconfigured = false;

function warnUnconfigured(queued: number): void {
  if (warnedUnconfigured) return;
  warnedUnconfigured = true;
  // Deliberately a single structured line, matching lib/diagnostics.ts, so a
  // dev build is loud exactly once and console dumps stay greppable.
  console.warn(
    "[dragonsheets] " +
      JSON.stringify({
        event: "ga-unconfigured",
        message:
          "GA4_MEASUREMENT_ID / GA4_API_SECRET are null — events are being queued, not sent. " +
          "Fill src/analytics/config.ts (DRAGONSHEETS_USER_TASKS.md Task 4a).",
        queued,
      })
  );
}

/** GA4 accepts a backdated `timestamp_micros` up to 72 hours in the past. */
const MAX_BACKDATE_MS = 72 * 60 * 60 * 1000;

export function bodyFor(clientId: string, envelopes: QueuedEnvelope[]): string {
  // All envelopes in one request share a client_id and user_id by
  // construction (one install, one signed-in user).
  const first = envelopes[0]!;
  const age = Date.now() - first.raisedAt;
  // A queued event flushed later must report when it HAPPENED, not when the
  // network came back — otherwise an offline session collapses into one
  // instant on reconnect. Only backdate what GA4 will still accept.
  const backdate = age > 2000 && age < MAX_BACKDATE_MS;
  return JSON.stringify({
    client_id: clientId,
    ...(first.userId ? { user_id: first.userId } : {}),
    ...(backdate ? { timestamp_micros: first.raisedAt * 1000 } : {}),
    ...(first.userProperties ? { user_properties: first.userProperties } : {}),
    events: envelopes.map((e) => ({
      name: e.name,
      params: e.params,
    })),
  });
}

async function post(clientId: string, envelopes: QueuedEnvelope[]): Promise<void> {
  const url = collectUrl();
  if (!url) throw new Error("unconfigured");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyFor(clientId, envelopes),
    keepalive: true,
  });
  // /mp/collect answers 204 with an empty body even for payloads it discards.
  // /debug/mp/collect answers 200 with validationMessages — surface those.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (DEBUG_ENDPOINT) {
    const text = await res.text().catch(() => "");
    logDiag("ga-debug-response", { body: text.slice(0, 500) });
  }
}

/**
 * Drain the queue oldest-first. Stops at the first failure and leaves the
 * remainder (including the one that failed) in place, so ordering is never
 * broken by a partial flush.
 */
export async function flushQueue(): Promise<SendResult> {
  try {
    const q = await readQueue();
    if (q.length === 0) return { ok: true, status: "sent", queued: 0 };

    if (!isAnalyticsConfigured()) {
      warnUnconfigured(q.length);
      return { ok: false, status: "unconfigured", queued: q.length };
    }

    const clientId = await getClientId();
    let remaining = q;
    // One request per envelope: batching would mean events with different
    // user_ids sharing an envelope, and the queue is small by construction.
    for (const env of q) {
      try {
        await post(clientId, [env]);
      } catch (err) {
        await writeQueue(remaining);
        logDiag("ga-flush-halted", { remaining: remaining.length, error: String(err) });
        return {
          ok: false,
          status: "error",
          queued: remaining.length,
          error: String(err),
        };
      }
      remaining = remaining.slice(1);
      await writeQueue(remaining);
      await markEventSent();
    }
    return { ok: true, status: "sent", queued: 0 };
  } catch (err) {
    // Storage timeout, JSON blow-up, anything — analytics never throws out.
    logDiag("ga-flush-failed", { error: String(err) });
    return { ok: false, status: "error", queued: -1, error: String(err) };
  }
}

/**
 * Raise one GA4 event.
 *
 * Always enqueues first and then flushes, rather than sending directly. That
 * costs one storage round-trip and buys a guarantee: an event can never
 * overtake an older queued one, so DebugView shows the funnel in the order it
 * actually happened.
 */
export async function sendEvent(
  name: string,
  params: EventParams = {},
  opts: SendOptions = {}
): Promise<SendResult> {
  try {
    const session = await touchSession();
    const envelope: QueuedEnvelope = {
      name: name.slice(0, 40),
      params: {
        ...scrub(params, MAX_PARAM_VALUE_CHARS),
        // Attached last so a caller can never accidentally override them.
        session_id: session.session_id,
        engagement_time_msec: session.engagement_time_msec,
      },
      raisedAt: Date.now(),
    };
    if (opts.userId) envelope.userId = String(opts.userId).slice(0, 256);
    const userProps = scrub(opts.userProperties, MAX_USER_PROPERTY_VALUE_CHARS);
    if (Object.keys(userProps).length > 0) {
      envelope.userProperties = Object.fromEntries(
        Object.entries(userProps).map(([k, v]) => [k, { value: v }])
      );
    }

    const queued = await enqueue(envelope);
    if (!isAnalyticsConfigured()) {
      warnUnconfigured(queued);
      return { ok: false, status: "unconfigured", queued };
    }
    const flushed = await flushQueue();
    return flushed.ok ? { ok: true, status: "sent", queued: 0 } : { ...flushed, status: "queued" };
  } catch (err) {
    logDiag("ga-send-failed", { name, error: String(err) });
    return { ok: false, status: "error", queued: -1, error: String(err) };
  }
}

/** Test seam: reset the once-per-lifetime warn latch. */
export function __resetWarnLatch(): void {
  warnedUnconfigured = false;
}
