/**
 * Sheet-access checks, memoised.
 *
 * The sidebar gates on access every time it opens (App.tsx): an unshared
 * spreadsheet has to land on the share screen, or the user gets a Syncs list
 * that can never write anything. That gate must not cost a round trip on every
 * toggle of the launcher pill — hence this cache.
 *
 * The asymmetry is the whole design:
 *
 *   GRANTED  is cached, for a few minutes. Access is a property of a Google
 *            share that the user just made; it does not evaporate mid-session,
 *            and re-asking on every toggle would be a spinner tax.
 *
 *   DENIED   is NEVER cached. Caching a denial is exactly how you trap
 *            someone: they go and share the sheet, come back, and the sidebar
 *            keeps insisting they haven't. A denial always re-asks.
 *
 * Module scope, not chrome.storage: the cache should not survive a page
 * reload. A reload is the cheapest way for a user to force a fresh answer, and
 * it should keep working.
 */
import { getBackend } from "./index";
import type { SheetAccess } from "./types";

/** Long enough to cover a working session's worth of open/close cycles. */
export const GRANT_TTL_MS = 10 * 60_000;

const grantedUntil = new Map<string, number>();

export function isKnownGranted(spreadsheetId: string, now = Date.now()): boolean {
  const until = grantedUntil.get(spreadsheetId);
  if (until === undefined) return false;
  if (until <= now) {
    grantedUntil.delete(spreadsheetId);
    return false;
  }
  return true;
}

/** Record an answer. `false` clears any memo — see the asymmetry above. */
export function rememberGrant(spreadsheetId: string, granted: boolean, now = Date.now()): void {
  if (granted) grantedUntil.set(spreadsheetId, now + GRANT_TTL_MS);
  else grantedUntil.delete(spreadsheetId);
}

/** Drop everything — called on sign-out, where the identity behind the grant changes. */
export function forgetGrants(): void {
  grantedUntil.clear();
}

/**
 * Check access, using the memo unless `force` is set.
 *
 * A cached hit resolves without `serviceAccountEmail`, so a caller that needs
 * the address (the share screen) must pass `force` or read it from a fresh
 * answer. The gate doesn't need it.
 */
export async function checkAccess(
  spreadsheetId: string,
  opts: { force?: boolean } = {}
): Promise<SheetAccess> {
  if (!opts.force && isKnownGranted(spreadsheetId)) {
    return { granted: true, checkedAt: Date.now() };
  }
  const res = await getBackend().checkSheetAccess(spreadsheetId);
  rememberGrant(spreadsheetId, res.granted);
  return res;
}
