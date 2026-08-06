/**
 * Context router for analytics.
 *
 * The sidebar React app runs as a **content script** on docs.google.com. A
 * `fetch()` from a content script is issued in the host page's CORS context,
 * so a POST to google-analytics.com from there is blocked — and would be
 * subject to Google Sheets' own CSP besides. The Measurement Protocol call
 * therefore has to happen in the service worker.
 *
 * `track()` hides that: call it from anywhere. In the service worker it goes
 * straight to ./mp.ts; in a content script or an extension page it hops to
 * the service worker over chrome.runtime messaging first.
 *
 * Dedupe state (sign_up fired?, which connections have activated?) lives in
 * chrome.storage.local, which every context shares, so it is enforced
 * wherever the call originates.
 */
import { logDiag } from "../lib/diagnostics";
import { MSG } from "../lib/messages";
import type { EventParams, SendOptions, SendResult } from "./mp";
import { sendEvent } from "./mp";

/**
 * True in the MV3 service worker. `document` exists in content scripts,
 * extension pages and the harness's DOM stub, and never in a worker global.
 */
export function isServiceWorkerContext(): boolean {
  return typeof document === "undefined";
}

export interface AnalyticsMessage {
  type: typeof MSG.analyticsEvent;
  name: string;
  params?: EventParams;
  options?: SendOptions;
}

export async function track(
  name: string,
  params: EventParams = {},
  options: SendOptions = {}
): Promise<SendResult> {
  try {
    if (isServiceWorkerContext()) return await sendEvent(name, params, options);

    const message: AnalyticsMessage = { type: MSG.analyticsEvent, name, params, options };
    const res = (await chrome.runtime.sendMessage(message)) as SendResult | undefined;
    return res ?? { ok: false, status: "error", queued: -1, error: "no response" };
  } catch (err) {
    // The service worker can be mid-restart, or the extension context can be
    // invalidated by a reload while a Sheets tab is still open. Neither is
    // worth breaking the UI over.
    logDiag("ga-track-relay-failed", { name, error: String(err) });
    return { ok: false, status: "error", queued: -1, error: String(err) };
  }
}
