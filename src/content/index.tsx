/**
 * Real content-script module (dynamic-imported by public/content-loader.js).
 * Exports onExecute(), called once by the loader shim.
 */
import { injectLauncher } from "./launcher";
import { mountSidebar } from "./mount";
import { getSpreadsheetId, loadSelectorMap, waitFor } from "./selector-map";
import { logDiag } from "../lib/diagnostics";

declare global {
  interface Window {
    __dragonsheetsLoaded?: boolean;
    /** Set by content-loader.js just before it import()s this module. */
    __dragonsheetsInjectedAt?: number;
  }
}

async function onExecute(info?: { injectedAt?: number }): Promise<void> {
  // Only actual spreadsheet documents (not /u/0/, marketing, or the picker).
  if (!getSpreadsheetId()) return;
  if (window.__dragonsheetsLoaded) return;
  window.__dragonsheetsLoaded = true;

  const selectors = await loadSelectorMap();

  // Wait for Google's chrome to exist. hopted does a one-shot read and gives
  // up; we observe with a cap and degrade gracefully (fallback launcher).
  const [bars, toolbar] = await Promise.all([
    waitFor(selectors.docsBars, 30000, "docsBars"),
    waitFor(selectors.docsToolbar, 30000, "docsToolbar"),
  ]);

  if (!bars) {
    // Diagnostic only — the sidebar is viewport-fixed and does not depend on
    // #docs-bars, but a miss here means Google's DOM shifted; we want the log.
    logDiag("docs-bars-missing-at-mount");
  }

  injectLauncher(toolbar);
  mountSidebar(selectors);

  logDiag("content-mounted", {
    loadMs: info?.injectedAt ? Date.now() - info.injectedAt : undefined,
    toolbarAnchored: Boolean(toolbar),
  });
}

// Self-executing on import: Vite app builds drop entry exports
// (preserveEntrySignatures: false), so the loader shim can't call an export —
// importing this module IS the execution. The loader records inject time in a
// shared-realm global first (loader and this module run in the same isolated
// content-script world).
void onExecute({ injectedAt: window.__dragonsheetsInjectedAt }).catch((err) => {
  logDiag("content-boot-failed", { error: String(err) });
});
