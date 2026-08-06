/**
 * The DragonSheets event schema. This file is the single source of truth for
 * what we send to GA4 — docs/ANALYTICS.md is generated from reading it.
 *
 * ## 🚫 Event names are NOT product-prefixed
 *
 * Not `dragonsheets_sign_up`. Not `ds_connect_amazon`. The names below are
 * byte-identical to the ones DragonRefunds, DragonReply and getdragonbot
 * send, and that is a deliberate, documented rule
 * (Dragon-marketing/skills/new-product-funnel/SKILL.md Phase 6):
 *
 *  · **GA4** — each product has its own property, so `sign_up` in DragonSheets
 *    and `sign_up` in DragonReply can never collide. Prefixing would break
 *    every cross-product comparison, key-event config and dashboard.
 *  · **Google Ads** — this is where names DO collide, because one Ads account
 *    (807-173-1091) imports from every property. The fix is to rename the
 *    imported *conversion action* to `DragonSheets (web) connect_amazon`,
 *    never the GA4 event.
 *
 * ## The conversion event
 *
 * `connect_amazon` is the umbrella and THE Google Ads conversion, counted
 * ONE_PER_CLICK. `connect_amazon_seller` / `connect_amazon_ads` fire
 * alongside it for segmentation and must never be starred as key events or
 * summed with it — one seller connection fires the umbrella AND the specific
 * event, so summing double-counts. See google-ads-setup/SKILL.md §5.
 *
 * ## Activations come from connection STATE, never from the OAuth popup
 *
 * `reconcileConnectionActivations()` below reads connections through the
 * BackendClient on sidebar mount and fires anything this install has not
 * logged. The OAuth popup's postMessage is a UI fast-path only and must not
 * fire events: when the popup is blocked, closed a second early, or the user
 * navigates back by hand, the connection still succeeds server-side and a
 * postMessage-only path loses the conversion silently. That is exactly how
 * DragonReply lost its first real connection.
 */
import { getBackend } from "../backend";
import type { ConnectionStatus, ConnectProvider } from "../backend/types";
import { logDiag } from "../lib/diagnostics";
import { STORAGE_KEYS, storageGet, storageSet } from "../lib/storage";
import {
  attributionParams,
  attributionUserProperties,
  readAttribution,
  readAttributionSource,
} from "./attribution";
import type { EventParams, SendOptions, SendResult } from "./mp";
import { track } from "./track";

/** Every event name this product sends. Adding one here means updating docs/ANALYTICS.md. */
export const EVENTS = {
  sidebarOpened: "sidebar_opened",
  signUp: "sign_up",
  sheetShared: "sheet_shared",
  /** Umbrella — THE Google Ads conversion. */
  connectAmazon: "connect_amazon",
  connectAmazonSeller: "connect_amazon_seller",
  connectAmazonAds: "connect_amazon_ads",
  syncCreated: "sync_created",
  agentPromptSent: "agent_prompt_sent",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Events that always carry the full attribution blob as params. */
const ATTRIBUTED_EVENTS: ReadonlySet<string> = new Set<string>([
  EVENTS.signUp,
  EVENTS.connectAmazon,
  EVENTS.connectAmazonSeller,
  EVENTS.connectAmazonAds,
]);

// ---------- the common envelope ----------

/**
 * Decorate an event with attribution and identity, then send it.
 *
 * · **user_properties** — attached to EVERY event. They are sticky in GA4, so
 *   re-sending is cheap and it guarantees a user who installed before the
 *   bridge landed still gets tagged on their next action.
 * · **event params** — the full blob (gclid and all) goes on the FIRST event
 *   this install ever sends, and on every conversion-carrying event
 *   thereafter. Attaching it to all events would burn the 25-param budget on
 *   `sidebar_opened` for no analytical gain.
 */
async function emit(
  name: EventName,
  params: EventParams = {},
  opts: SendOptions = {}
): Promise<SendResult> {
  try {
    const [attribution, source, storedUserId] = await Promise.all([
      readAttribution(),
      readAttributionSource(),
      storageGet<string>(STORAGE_KEYS.gaUserId),
    ]);

    const firstEver =
      (await storageGet<boolean>(STORAGE_KEYS.gaAttributionAttached)) !== true;
    const wantsAttribution = firstEver || ATTRIBUTED_EVENTS.has(name);

    const finalParams: EventParams = {
      ...(wantsAttribution ? attributionParams(attribution) : {}),
      signup_source: attributionUserProperties(attribution, source).signup_source,
      ...params,
    };

    if (firstEver) await storageSet(STORAGE_KEYS.gaAttributionAttached, true);

    return await track(name, finalParams, {
      userId: opts.userId ?? storedUserId,
      userProperties: {
        ...attributionUserProperties(attribution, source),
        ...opts.userProperties,
      },
    });
  } catch (err) {
    logDiag("ga-emit-failed", { name, error: String(err) });
    return { ok: false, status: "error", queued: -1, error: String(err) };
  }
}

// ---------- the events ----------

/** Sidebar panel opened (launcher click or deep link). Fires per open. */
export function trackSidebarOpened(params: { source?: "launcher" | "deep_link" } = {}) {
  return emit(EVENTS.sidebarOpened, { source: params.source ?? "launcher" });
}

/**
 * Google sign-in succeeded.
 *
 * ⚠️ **Fires exactly once, ever.** GA4's `sign_up` is a first-registration
 * event; firing it on each sign-in inflates it and (worse) makes the
 * sign_up→connect_amazon ratio meaningless. The dedupe flag mirrors
 * frontend-shared's rule that `identifyUserAcrossPlatforms()` is the ONLY
 * caller of `sign_up` — here the flag replaces that discipline, because the
 * sidebar can mount in dozens of tabs at once.
 *
 * Also persists `user_id` so every later event is joined to this account.
 * The email and name are deliberately NOT sent: on the web surfaces they go
 * to Clarity only, and Clarity cannot run inside an extension — so no PII at
 * all leaves here.
 */
export async function trackSignUp(user: { id: string }): Promise<SendResult> {
  try {
    if (user?.id) await storageSet(STORAGE_KEYS.gaUserId, user.id);

    const already = await storageGet<boolean>(STORAGE_KEYS.gaSignupLogged);
    if (already === true) {
      logDiag("ga-signup-deduped");
      return { ok: true, status: "sent", queued: 0 };
    }
    // Set the flag BEFORE sending: a failed send is queued and will still go
    // out, so a retry here would double-count. Under-counting a failed event
    // is not possible; double-counting a queued one is.
    await storageSet(STORAGE_KEYS.gaSignupLogged, true);

    return await emit(EVENTS.signUp, { method: "google" }, { userId: user.id });
  } catch (err) {
    logDiag("ga-signup-failed", { error: String(err) });
    return { ok: false, status: "error", queued: -1, error: String(err) };
  }
}

/** The service account was granted Editor access to a spreadsheet. */
export function trackSheetShared() {
  return emit(EVENTS.sheetShared, {});
}

/** A sync was created (the wizard's "Create sync" succeeded). */
export function trackSyncCreated(params: {
  schedule: string;
  reportCount: number;
  columnCount: number;
  fromTemplate?: boolean;
  fromAgent?: boolean;
}) {
  return emit(EVENTS.syncCreated, {
    schedule: params.schedule,
    report_count: params.reportCount,
    column_count: params.columnCount,
    from_template: params.fromTemplate === true,
    from_agent: params.fromAgent === true,
  });
}

/**
 * A prompt was submitted to the AI agent. Only the LENGTH is sent — prompt
 * text can contain ASINs, brand names and revenue figures, none of which
 * belong in GA4.
 */
export function trackAgentPromptSent(params: { promptLength: number; turn: number }) {
  return emit(EVENTS.agentPromptSent, {
    prompt_length: params.promptLength,
    turn: params.turn,
  });
}

// ---------- activations ----------

type ActivationProvider = "amazon_seller" | "amazon_ads";

/**
 * The same provider has three spellings across the stack:
 * `amazon-selling-partner` (what /v1/connections and our BackendClient
 * return), `amazon_selling_partner` (an older consumer type), and
 * `amazon_seller` (frontend-shared's internal name). Normalise defensively —
 * getting this wrong files every seller connection as an "ads" one, and
 * because the umbrella still fires, the mistake is invisible in the
 * conversion count.
 */
export function normaliseProvider(raw: string): ActivationProvider {
  return raw.toLowerCase().replace(/-/g, "_").includes("ads")
    ? "amazon_ads"
    : "amazon_seller";
}

async function loggedActivations(): Promise<string[]> {
  const v = await storageGet<string[]>(STORAGE_KEYS.activations);
  return Array.isArray(v) ? v : [];
}

async function markActivationLogged(id: string): Promise<void> {
  const seen = await loggedActivations();
  if (seen.includes(id)) return;
  await storageSet(STORAGE_KEYS.activations, [...seen, id].slice(-200));
}

/**
 * Fire the umbrella + the specific event for one newly-seen connection.
 * Exported for the harness; product code goes through
 * `reconcileConnectionActivations()`.
 */
export async function trackAccountConnected(
  provider: ActivationProvider,
  opts: { connectionId?: string } = {}
): Promise<boolean> {
  const { connectionId } = opts;
  if (connectionId && (await loggedActivations()).includes(connectionId)) return false;
  // Claim the id before sending, for the same reason as sign_up: a failed
  // send is queued, not lost, so retrying would double-count.
  if (connectionId) await markActivationLogged(connectionId);

  const isSeller = provider === "amazon_seller";
  const specific = isSeller ? EVENTS.connectAmazonSeller : EVENTS.connectAmazonAds;
  const userProp = isSeller ? "spapi_connected" : "ads_connected";

  // Umbrella FIRST — it is the Ads conversion, so if only one of the two
  // makes it out of a dying service worker, it should be this one.
  await emit(EVENTS.connectAmazon, { provider }, { userProperties: { [userProp]: "true" } });
  await emit(specific, { provider });
  return true;
}

/** ms; a connection older than this is not re-activated on a fresh install. */
const ACTIVATION_MAX_AGE_MS = 7 * 86_400_000;

/**
 * One connection, flattened out of whatever shape the backend exposes.
 * `BackendClient` models connections as a per-provider status object today
 * and as a list of accounts once connected; Phase 8's real client will have a
 * `/v1/connections`-shaped list. This adapter keeps the reconciler stable
 * across all three.
 */
export interface ReconcilableConnection {
  id: string;
  provider: string;
  connectedAt?: number;
}

/** Flatten ConnectionStatus (+ account ids where available) into connections. */
export async function listReconcilableConnections(): Promise<ReconcilableConnection[]> {
  const backend = getBackend();
  const status: ConnectionStatus = await backend.getConnectionStatus();

  // Account ids are the closest thing we have to server-side connection ids,
  // and they are what Phase 8 will return verbatim. When the accounts call
  // fails (or a connection has no account yet) we fall back to a synthetic
  // `<provider>:<connectedAt>` id — still stable per connection, since a
  // reconnect produces a new connectedAt and therefore a new activation.
  const accounts = await backend.listAccounts().catch(() => []);
  const idFor = (provider: ConnectProvider, connectedAt?: number): string =>
    accounts.find((a) => a.provider === provider)?.id ?? `${provider}:${connectedAt ?? 0}`;

  const out: ReconcilableConnection[] = [];
  if (status?.sellerCentral?.state === "connected") {
    out.push({
      id: idFor("amazon-selling-partner", status.sellerCentral.connectedAt),
      provider: "amazon-selling-partner",
      connectedAt: status.sellerCentral.connectedAt,
    });
  }
  if (status?.ads?.state === "connected") {
    out.push({
      id: idFor("amazon-ads", status.ads.connectedAt),
      provider: "amazon-ads",
      connectedAt: status.ads.connectedAt,
    });
  }
  return out;
}

/**
 * Fire activation events for any connection the BACKEND reports that this
 * install has never logged. Call once when the sidebar mounts.
 *
 * Returns how many connections were newly activated.
 */
export async function reconcileConnectionActivations(): Promise<number> {
  try {
    const connections = await listReconcilableConnections();
    const cutoff = Date.now() - ACTIVATION_MAX_AGE_MS;
    let fired = 0;

    for (const c of connections) {
      if (!c.id || !c.provider) continue;
      if ((await loggedActivations()).includes(c.id)) continue;

      // Recency gate. The dedupe list lives in chrome.storage.local, which is
      // EMPTY on a machine this user has not installed on before — without
      // this, installing on a second laptop would re-fire an activation for
      // every account they already had and inflate the conversion Smart
      // Bidding chases. A missing timestamp means a legacy row: treat as old.
      if (!Number.isFinite(c.connectedAt) || (c.connectedAt as number) < cutoff) {
        await markActivationLogged(c.id); // remember it so we stop re-checking
        continue;
      }

      if (await trackAccountConnected(normaliseProvider(c.provider), { connectionId: c.id })) {
        fired++;
      }
    }
    if (fired > 0) logDiag("ga-activations-reconciled", { fired });
    return fired;
  } catch (err) {
    // Analytics must never break the sidebar.
    logDiag("ga-activation-reconcile-failed", { error: String(err) });
    return 0;
  }
}
