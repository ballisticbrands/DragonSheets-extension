/**
 * Lightweight state-based router with hopted-style deep-linkable routes
 * (teardown §5.1): the current route is mirrored into a `dsr=<route>` query
 * parameter on the live Google Sheets URL via history.pushState, restored on
 * load, and browser Back/Forward works via popstate. Support can send a user
 * a Sheets URL that opens a specific DragonSheets screen.
 */

export const ROUTES = [
  "welcome",
  "share-spreadsheet",
  "onboarding-completed",
  "home",
  "connect-amazon",
  "syncs",
  "agent",
  "templates",
  "settings",
] as const;

export type Route = (typeof ROUTES)[number];

export const ROUTE_PARAM = "dsr";

export function isRoute(value: string | null): value is Route {
  return value !== null && (ROUTES as readonly string[]).includes(value);
}

/** Read the deep-link route from the current Sheets URL, if present. */
export function readRouteFromUrl(): Route | null {
  try {
    const v = new URL(location.href).searchParams.get(ROUTE_PARAM);
    return isRoute(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Mirror a route into the Sheets URL (or strip it with null). Uses
 * push/replaceState only — never a navigation; Sheets keeps its own state in
 * the path + #gid= hash, which we preserve untouched.
 */
export function writeRouteToUrl(route: Route | null, mode: "push" | "replace" = "push"): void {
  try {
    const url = new URL(location.href);
    if (route === null) url.searchParams.delete(ROUTE_PARAM);
    else url.searchParams.set(ROUTE_PARAM, route);
    const href = url.toString();
    if (href === location.href) return;
    if (mode === "push") history.pushState(history.state, "", href);
    else history.replaceState(history.state, "", href);
  } catch {
    // URL manipulation must never break the app.
  }
}
