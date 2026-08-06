/**
 * MV3 module service worker.
 *
 * Responsibilities (kept deliberately small — the sidebar talks to the
 * BackendClient directly; there's no REST/WebSocket relay until Phase 8):
 *  - onInstalled → open go.getdragonsheets.com/installed/ (skipped for
 *    unpacked dev installs, hopted §8 pattern)
 *  - setUninstallURL → /uninstalled/ churn survey
 *  - fetch + cache /bootstrap.json (remote selector-map override), refreshed
 *    by a chrome.alarms schedule (alarms survive SW suspension; setTimeout
 *    doesn't)
 *  - onMessage router: real Google sign-in (chrome.identity is SW-only) and
 *    GA4 Measurement Protocol sends (content-script fetch can't reach GA4 —
 *    it runs in docs.google.com's CORS context)
 *  - onMessageExternal: attribution blob + GA4 client_id from
 *    go.getdragonsheets.com (externally_connectable delivery path)
 *
 * Every init function is wrapped in its own try/catch so one failure can't
 * take down messaging (teardown §8 pattern).
 */
import { adoptBridgeClientId } from "../analytics/client-id";
import { flushQueue, sendEvent } from "../analytics/mp";
import type { AnalyticsMessage } from "../analytics/track";
import { handleGoogleSignIn } from "../auth/real";
import { logDiag } from "../lib/diagnostics";
import { MSG } from "../lib/messages";
import { STORAGE_KEYS, storageGet, storageSet } from "../lib/storage";

const SITE_ORIGIN = "https://go.getdragonsheets.com";
const BOOTSTRAP_URL = `${SITE_ORIGIN}/bootstrap.json`;
const INSTALLED_URL = `${SITE_ORIGIN}/installed/`;
const UNINSTALLED_URL = `${SITE_ORIGIN}/uninstalled/`;
const BOOTSTRAP_ALARM = "ds-refresh-bootstrap";
const BOOTSTRAP_PERIOD_MINUTES = 6 * 60;

// ---------- bootstrap.json (remote selector map) ----------

async function refreshBootstrap(reason: string): Promise<void> {
  try {
    const res = await fetch(BOOTSTRAP_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { selectors?: unknown };
    if (json && typeof json.selectors === "object" && json.selectors !== null) {
      await storageSet(STORAGE_KEYS.selectorMap, json.selectors);
      await storageSet(STORAGE_KEYS.bootstrapFetchedAt, Date.now());
      logDiag("bootstrap-refreshed", { reason });
    } else {
      logDiag("bootstrap-malformed", { reason });
    }
  } catch (err) {
    // Offline / site not deployed yet — bundled defaults keep working.
    logDiag("bootstrap-fetch-failed", { reason, error: String(err) });
  }
}

// ---------- init functions ----------

function initOnInstalled(): void {
  chrome.runtime.onInstalled.addListener((details) => {
    void refreshBootstrap(`onInstalled:${details.reason}`);
    if (details.reason === "install") {
      // Default the attribution source to "direct". The bridge overwrites it
      // with "bridge" if /installed/ manages to reach us; if it never does —
      // the user installed straight from a Chrome Web Store search, a shared
      // link, or with third-party cookies blocked — "direct" is the truthful
      // answer and we record it now rather than leaving the field absent.
      void storageSet(STORAGE_KEYS.attributionSource, "direct");
      // getSelf works without the "management" permission for self-inspection.
      chrome.management.getSelf((self) => {
        if (self.installType === "development") {
          logDiag("install-dev-mode-skip-welcome");
          return;
        }
        // No "tabs" permission is needed for tabs.create with a URL.
        chrome.tabs.create({ url: INSTALLED_URL }).catch((err) => {
          logDiag("installed-page-open-failed", { error: String(err) });
        });
      });
    }
  });
}

function initUninstallUrl(): void {
  void chrome.runtime.setUninstallURL(UNINSTALLED_URL);
}

function initAlarms(): void {
  void chrome.alarms.create(BOOTSTRAP_ALARM, {
    periodInMinutes: BOOTSTRAP_PERIOD_MINUTES,
    delayInMinutes: 1,
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BOOTSTRAP_ALARM) void refreshBootstrap("alarm");
  });
}

function initOnStartup(): void {
  chrome.runtime.onStartup.addListener(() => {
    void refreshBootstrap("onStartup");
  });
}

function initMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const type = (message as { type?: string } | null)?.type;
    switch (type) {
      case MSG.authGoogleSignIn:
        handleGoogleSignIn()
          .then(sendResponse)
          .catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true; // async response
      case MSG.refreshBootstrap:
        refreshBootstrap("message")
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true;
      case MSG.analyticsEvent: {
        // GA4 Measurement Protocol relay. sendEvent never rejects, but the
        // catch is kept so a future refactor can't turn an analytics bug into
        // a dropped sendResponse (which would hang the caller's await).
        const m = message as AnalyticsMessage;
        sendEvent(m.name, m.params ?? {}, m.options ?? {})
          .then(sendResponse)
          .catch((err) =>
            sendResponse({ ok: false, status: "error", queued: -1, error: String(err) })
          );
        return true;
      }
      default:
        return undefined;
    }
  });
}

/**
 * Attribution bridge receiver.
 *
 * go.getdragonsheets.com/installed/ reads the LP's `dragonbot_attribution`
 * cookie + `dragonbot_attribution_v1` localStorage AND the page's own GA4
 * client_id (out of the `_ga` cookie), then hands all of it to us via
 * externally_connectable — the manifest restricts that channel to that one
 * origin, so no other site can write our attribution.
 *
 * This is the only thing that survives the Chrome Web Store: the store strips
 * every query param, so without the bridge an install is an anonymous new GA4
 * user and the ad click that paid for it is unattributable.
 *
 * Two side effects beyond storing the blob:
 *  - adopt the LP's client_id as ours (subject to the precedence rules in
 *    analytics/client-id.ts), which is what stitches LP session → extension
 *  - stamp `attribution_source: "bridge"`, overriding the "direct" default
 *    written at install time
 */
function initExternalMessages(): void {
  chrome.runtime.onMessageExternal.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as { type?: string; payload?: Record<string, unknown> } | null;
    if (msg?.type === MSG.attribution && msg.payload !== undefined) {
      void (async () => {
        try {
          const payload = msg.payload as { gaClientId?: unknown };
          const hadAny = (await storageGet<boolean>(STORAGE_KEYS.gaSentAny)) === true;
          const clientIdOutcome = await adoptBridgeClientId(payload?.gaClientId);

          await storageSet(STORAGE_KEYS.attribution, {
            payload: msg.payload,
            origin: sender.origin,
            receivedAt: Date.now(),
          });
          await storageSet(STORAGE_KEYS.attributionSource, "bridge");

          logDiag("attribution-stored", {
            origin: sender.origin,
            clientId: clientIdOutcome,
            hadPriorEvents: hadAny,
          });
          sendResponse({ ok: true, clientId: clientIdOutcome });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true;
    }
    return undefined;
  });
}

/**
 * Retry any events that were queued while offline or before the service
 * worker had credentials. MV3 wakes the worker for alarms and startup, so
 * these are the two cheap places to drain without holding a timer.
 */
function initAnalyticsFlush(): void {
  chrome.runtime.onStartup.addListener(() => {
    void flushQueue();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BOOTSTRAP_ALARM) void flushQueue();
  });
}

/** Toolbar icon → options page (the real entry point is the in-Sheets
 * launcher; the action icon is just a shortcut, hopted §8). */
function initActionClick(): void {
  chrome.action.onClicked.addListener(() => {
    void chrome.runtime.openOptionsPage();
  });
}

// ---------- boot ----------

[
  initOnInstalled,
  initUninstallUrl,
  initAlarms,
  initOnStartup,
  initMessageRouter,
  initExternalMessages,
  initAnalyticsFlush,
  initActionClick,
].forEach((fn) => {
  try {
    fn();
  } catch (err) {
    console.error(`[dragonsheets] SW init failed in ${fn.name}:`, err);
  }
});
