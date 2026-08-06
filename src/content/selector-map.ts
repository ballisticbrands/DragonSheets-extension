/**
 * SelectorMap — every Google-owned selector the extension touches, in ONE
 * place (single blast radius, hopted-teardown §2.3), with:
 *
 *  - bundled defaults,
 *  - runtime overrides from https://go.getdragonsheets.com/bootstrap.json
 *    (fetched by the service worker, cached in chrome.storage.local), so a
 *    Google Sheets DOM change is fixable server-side in minutes instead of a
 *    CWS review cycle (teardown §9.4 hardening #3),
 *  - a MutationObserver-based waitFor() instead of one-shot getElementById
 *    (teardown §9.2 avoid-#5: hopted silently no-ops if #docs-bars renders
 *    late — we don't).
 */
import { logDiag } from "../lib/diagnostics";
import { STORAGE_KEYS, storageGet } from "../lib/storage";

export type SelectorKey =
  | "docsBars"
  | "docsToolbar"
  | "shareButton"
  | "titleLabel"
  | "nameBox"
  | "presenceContainer"
  | "sheetTabName";

export type SelectorMap = Record<SelectorKey, string>;

export const DEFAULT_SELECTORS: SelectorMap = {
  docsBars: "#docs-bars",
  docsToolbar: "#docs-toolbar",
  shareButton: "#docs-titlebar-share-client-button",
  titleLabel: "#docs-title-input-label-inner",
  nameBox: "#t-name-box",
  presenceContainer: "#docs-presence-container",
  sheetTabName: ".docs-sheet-tab-name",
};

/**
 * Merge remote overrides (if the SW has cached any) over the bundled
 * defaults. Offline / never-fetched / malformed → defaults, silently.
 */
export async function loadSelectorMap(): Promise<SelectorMap> {
  try {
    const remote = await storageGet<Partial<Record<string, unknown>>>(
      STORAGE_KEYS.selectorMap
    );
    if (!remote || typeof remote !== "object") return { ...DEFAULT_SELECTORS };
    const merged: SelectorMap = { ...DEFAULT_SELECTORS };
    for (const key of Object.keys(DEFAULT_SELECTORS) as SelectorKey[]) {
      const v = remote[key];
      if (typeof v === "string" && v.length > 0) merged[key] = v;
    }
    return merged;
  } catch (err) {
    logDiag("selector-map-load-failed", { error: String(err) });
    return { ...DEFAULT_SELECTORS };
  }
}

/**
 * Resolve a selector now, or watch the DOM until it appears (or the timeout
 * elapses). Never throws; a miss returns null and emits a single structured
 * diagnostic line.
 */
export function waitFor(
  selector: string,
  timeoutMs = 15000,
  key?: SelectorKey | string
): Promise<Element | null> {
  const immediate = document.querySelector(selector);
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (el: Element | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      if (!el) {
        logDiag("selector-miss", { key: key ?? selector, selector, timeoutMs });
      }
      resolve(el);
    };
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) finish(el);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
    // Re-check once in case the node appeared between querySelector and observe.
    const el = document.querySelector(selector);
    if (el) finish(el);
  });
}

/** Spreadsheet id from the Sheets URL — prefer URL/state over DOM (teardown §9.4 #7). */
export function getSpreadsheetId(href = location.href): string | null {
  const m = href.match(/\/spreadsheets\/d\/([^/]+)/);
  return m?.[1] ?? null;
}
