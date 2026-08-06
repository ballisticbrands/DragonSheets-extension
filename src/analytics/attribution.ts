/**
 * Attribution, extension-side.
 *
 * The shape is frontend-shared's `Attribution` interface
 * (frontend-shared/src/attribution.ts) verbatim — the bridge page hands us
 * whatever the landing page captured under the `dragonbot_attribution` cookie
 * / `dragonbot_attribution_v1` localStorage key, so staying byte-compatible
 * with that contract is what lets a DragonSheets install be analysed the same
 * way as every other Dragon product.
 *
 * Where the values go, and why they are split:
 *
 *  · **Event params** get the full blob (gclid included). GA4 allows 100
 *    characters per event-parameter value; a gclid is ~90.
 *  · **User properties** get only the short, durable fields. GA4 truncates
 *    user-property values at **36 characters** — a gclid stored there arrives
 *    mangled and useless, which is a genuinely easy way to lose ad
 *    attribution. So: `signup_source`, `utm_source/medium/campaign`,
 *    `attribution_source` only.
 */
import { STORAGE_KEYS, storageGet } from "../lib/storage";

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
  referrer?: string;
  landing_page?: string;
  captured_at?: string;
}

export type AttributionSource = "bridge" | "direct";

/** What the service worker persists when the bridge (or nothing) reports in. */
export interface StoredAttribution {
  payload?: { attribution?: Attribution; gaClientId?: string } | Record<string, unknown>;
  origin?: string;
  receivedAt?: number;
}

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
const CLICK_ID_KEYS = ["gclid", "fbclid", "msclkid"] as const;

/**
 * Normalise whatever the bridge sent into an Attribution.
 *
 * Tolerant on purpose: the bridge has shipped two shapes over its life
 * (`{attribution, gaClientId}` today, a bare blob in the Phase-3 stub) and a
 * page we do not control could send a third. Anything unrecognised yields an
 * empty object rather than an exception.
 */
export function normaliseAttribution(raw: unknown): Attribution {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const source = (obj.attribution && typeof obj.attribution === "object"
    ? obj.attribution
    : obj) as Record<string, unknown>;

  const out: Attribution = {};
  for (const k of [...UTM_KEYS, ...CLICK_ID_KEYS] as const) {
    const v = source[k];
    if (typeof v === "string" && v) out[k] = v.slice(0, 256);
  }
  for (const k of ["referrer", "landing_page", "captured_at"] as const) {
    const v = source[k];
    if (typeof v === "string" && v) out[k] = v.slice(0, 2048);
  }
  return out;
}

export async function readAttribution(): Promise<Attribution> {
  const stored = await storageGet<StoredAttribution>(STORAGE_KEYS.attribution);
  return normaliseAttribution(stored?.payload);
}

export async function readAttributionSource(): Promise<AttributionSource> {
  const v = await storageGet<AttributionSource>(STORAGE_KEYS.attributionSource);
  // Absent means the bridge never reported: a direct install (CWS search,
  // a shared link, a colleague's recommendation).
  return v === "bridge" ? "bridge" : "direct";
}

/**
 * Same derivation as frontend-shared's `deriveSignupSource` — keep them
 * identical so `signup_source` means the same thing in every property.
 */
export function deriveSignupSource(a: Attribution | undefined): string {
  if (!a) return "direct";
  if (a.gclid) return "google_ads";
  if (a.fbclid) return "meta_ads";
  if (a.msclkid) return "microsoft_ads";
  if (a.utm_source) return a.utm_source;
  return "direct";
}

/** Full blob as event params — safe up to GA4's 100-char param limit. */
export function attributionParams(a: Attribution): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** Short, durable fields only — GA4 truncates user-property values at 36 chars. */
export function attributionUserProperties(
  a: Attribution,
  source: AttributionSource
): Record<string, string> {
  const props: Record<string, string> = {
    signup_source: deriveSignupSource(a),
    attribution_source: source,
  };
  if (a.utm_source) props.utm_source = a.utm_source;
  if (a.utm_medium) props.utm_medium = a.utm_medium;
  if (a.utm_campaign) props.utm_campaign = a.utm_campaign;
  // Presence-only flags: the ids themselves do not survive 36 characters,
  // but "did this user arrive from a paid click" does, and it is what the
  // audience builder actually needs.
  if (a.gclid) props.has_gclid = "true";
  if (a.fbclid) props.has_fbclid = "true";
  return props;
}
