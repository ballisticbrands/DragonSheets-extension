/**
 * GA4 sessions for Measurement Protocol events.
 *
 * ⚠️ THE CLASSIC MP TRAP — read this before touching anything here.
 *
 * The Measurement Protocol will happily accept an event with neither
 * `session_id` nor `engagement_time_msec`. It returns `204 No Content`, the
 * event appears in **DebugView** and in **Realtime**, and then it is invisible
 * in every standard report — Events, Conversions, Acquisition, Explorations,
 * all of it. Nothing errors. Nothing warns.
 *
 * The reason: GA4's standard reports are session-scoped. An event with no
 * session_id belongs to no session, and an event with no engagement_time_msec
 * never marks its session engaged. The event is stored and then filtered out
 * of everything a human looks at. This has bitten every team that has ever
 * wired MP, which is why both fields are attached centrally in ./mp.ts rather
 * than being left to callers.
 *
 * So: **every event this extension sends carries both fields.** There is no
 * code path that omits them.
 *
 * Session semantics we replicate from gtag.js:
 *  - a session is identified by a `session_id` (unix seconds at session start)
 *  - it expires after 30 minutes of inactivity
 *  - `engagement_time_msec` is the foreground time attributable to this event;
 *    we approximate it as the gap since the previous event, clamped
 */
import { STORAGE_KEYS, storageGet, storageSet } from "../lib/storage";

/** GA4's default session timeout. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Floor for engagement_time_msec. Zero is treated as "not engaged", which
 * defeats the point, so we never send it.
 */
export const MIN_ENGAGEMENT_MS = 1;

/**
 * Ceiling for engagement_time_msec. The real gap between two events can be
 * hours (the sidebar sits open in a background tab); reporting that as
 * engagement would wildly inflate Average Engagement Time.
 */
export const MAX_ENGAGEMENT_MS = 60_000;

/** What we send for the first event of a session — matches Google's samples. */
export const DEFAULT_ENGAGEMENT_MS = 100;

export interface SessionRecord {
  /** Unix SECONDS at session start, as a string — gtag.js's own convention. */
  id: string;
  startedAt: number;
  lastEventAt: number;
}

export interface SessionFields {
  session_id: string;
  engagement_time_msec: number;
}

function newSession(now: number): SessionRecord {
  return { id: String(Math.floor(now / 1000)), startedAt: now, lastEventAt: now };
}

/**
 * Return the session fields for an event about to be sent, rolling the
 * session over if it has been idle for more than 30 minutes, and recording
 * this event as the session's latest activity.
 *
 * `now` is injectable so the harness can exercise the rollover without
 * sleeping for half an hour.
 */
export async function touchSession(now: number = Date.now()): Promise<SessionFields> {
  const stored = await storageGet<SessionRecord>(STORAGE_KEYS.gaSession);

  const expired =
    !stored ||
    typeof stored.lastEventAt !== "number" ||
    now - stored.lastEventAt > SESSION_TIMEOUT_MS;

  if (expired) {
    const fresh = newSession(now);
    await storageSet(STORAGE_KEYS.gaSession, fresh);
    return { session_id: fresh.id, engagement_time_msec: DEFAULT_ENGAGEMENT_MS };
  }

  const gap = Math.max(MIN_ENGAGEMENT_MS, Math.min(MAX_ENGAGEMENT_MS, now - stored.lastEventAt));
  await storageSet(STORAGE_KEYS.gaSession, {
    ...stored,
    lastEventAt: now,
  } satisfies SessionRecord);
  return { session_id: stored.id, engagement_time_msec: gap };
}

/** Read the session without touching it (diagnostics only). */
export async function peekSession(): Promise<SessionRecord | undefined> {
  return storageGet<SessionRecord>(STORAGE_KEYS.gaSession);
}
