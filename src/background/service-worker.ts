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
 *  - onMessage router: real Google sign-in (chrome.identity is SW-only)
 *  - onMessageExternal: attribution blob from go.getdragonsheets.com
 *    (externally_connectable token/attribution delivery path)
 *
 * Every init function is wrapped in its own try/catch so one failure can't
 * take down messaging (teardown §8 pattern).
 */
import { handleGoogleSignIn } from "../auth/real";
import { logDiag } from "../lib/diagnostics";
import { MSG } from "../lib/messages";
import { STORAGE_KEYS, storageSet } from "../lib/storage";

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
      default:
        return undefined;
    }
  });
}

/** Attribution bridge: go.getdragonsheets.com/installed/ reads the
 * dragonbot_attribution cookie + localStorage and hands the blob to us via
 * externally_connectable (manifest-restricted to that origin). */
function initExternalMessages(): void {
  chrome.runtime.onMessageExternal.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as { type?: string; payload?: unknown } | null;
    if (msg?.type === MSG.attribution && msg.payload !== undefined) {
      void storageSet(STORAGE_KEYS.attribution, {
        payload: msg.payload,
        origin: sender.origin,
        receivedAt: Date.now(),
      })
        .then(() => {
          logDiag("attribution-stored", { origin: sender.origin });
          sendResponse({ ok: true });
        })
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    return undefined;
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
  initActionClick,
].forEach((fn) => {
  try {
    fn();
  } catch (err) {
    console.error(`[dragonsheets] SW init failed in ${fn.name}:`, err);
  }
});
