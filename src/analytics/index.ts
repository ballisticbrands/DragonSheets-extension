/**
 * Analytics barrel — import from here, not from the individual modules.
 *
 * Why this layer exists at all: MV3 bans remote code, so gtag.js cannot run
 * inside the extension. In-extension events reach the SAME GA4 property via
 * the Measurement Protocol, sent from the service worker. Full rationale,
 * event schema and the DebugView runbook: docs/ANALYTICS.md.
 */
export {
  EVENTS,
  type EventName,
  trackSidebarOpened,
  trackSignUp,
  trackSheetShared,
  trackSyncCreated,
  trackAgentPromptSent,
  trackAccountConnected,
  reconcileConnectionActivations,
  listReconcilableConnections,
  normaliseProvider,
} from "./events";
export { track, isServiceWorkerContext, type AnalyticsMessage } from "./track";
export { sendEvent, flushQueue, type SendResult } from "./mp";
export { getClientId, adoptBridgeClientId, mintClientId, isValidClientId } from "./client-id";
export { touchSession, peekSession } from "./session";
export {
  readAttribution,
  readAttributionSource,
  normaliseAttribution,
  deriveSignupSource,
  type Attribution,
  type AttributionSource,
} from "./attribution";
export { GA4_MEASUREMENT_ID, GA4_API_SECRET, DEBUG_ENDPOINT, isAnalyticsConfigured } from "./config";
