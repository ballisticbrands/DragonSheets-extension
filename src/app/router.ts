/**
 * Lightweight state-based router with hopted-style deep-linkable routes
 * (teardown §5.1): the current route is mirrored into a `dsr=<route>` query
 * parameter on the live Google Sheets URL via history.pushState, restored on
 * load, and browser Back/Forward works via popstate. Support can send a user
 * a Sheets URL that opens a specific DragonSheets screen.
 *
 * Screens with sub-state (which wizard step, which sync, which settings tab)
 * carry it in `dsp-<key>=<value>` params — hopted's `hoip-<prop>` idea, so a
 * deep link can land on "the columns step of a new sync from the TACOS
 * template" rather than just "the wizard".
 */

export const ROUTES = [
  "welcome",
  "share-spreadsheet",
  "onboarding-completed",
  "home",
  "connect-amazon",
  "syncs",
  "sync-new",
  "sync-detail",
  "agent",
  "templates",
  "settings",
] as const;

export type RouteName = (typeof ROUTES)[number];

export type RouteParams = Record<string, string>;

export interface Route {
  name: RouteName;
  params: RouteParams;
}

/** Most navigations don't need params — accept the bare name too. */
export type RouteLike = RouteName | Route;

export const ROUTE_PARAM = "dsr";
export const PARAM_PREFIX = "dsp-";

export function isRouteName(value: string | null): value is RouteName {
  return value !== null && (ROUTES as readonly string[]).includes(value);
}

export function toRoute(r: RouteLike): Route {
  return typeof r === "string" ? { name: r, params: {} } : r;
}

export function route(name: RouteName, params: RouteParams = {}): Route {
  return { name, params };
}

export function sameRoute(a: Route | null, b: Route | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.name !== b.name) return false;
  const ka = Object.keys(a.params);
  const kb = Object.keys(b.params);
  return ka.length === kb.length && ka.every((k) => a.params[k] === b.params[k]);
}

/** Read the deep-link route (and its params) from the current Sheets URL. */
export function readRouteFromUrl(): Route | null {
  try {
    const url = new URL(location.href);
    const name = url.searchParams.get(ROUTE_PARAM);
    if (!isRouteName(name)) return null;
    const params: RouteParams = {};
    url.searchParams.forEach((value, key) => {
      if (key.startsWith(PARAM_PREFIX)) params[key.slice(PARAM_PREFIX.length)] = value;
    });
    return { name, params };
  } catch {
    return null;
  }
}

/**
 * Mirror a route into the Sheets URL (or strip it with null). Uses
 * push/replaceState only — never a navigation; Sheets keeps its own state in
 * the path + #gid= hash, which we preserve untouched.
 */
export function writeRouteToUrl(r: Route | null, mode: "push" | "replace" = "push"): void {
  try {
    const url = new URL(location.href);
    // Always clear our own params first: stale ones from the previous screen
    // would otherwise leak into the next.
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith(PARAM_PREFIX)) url.searchParams.delete(key);
    }
    if (r === null) {
      url.searchParams.delete(ROUTE_PARAM);
    } else {
      url.searchParams.set(ROUTE_PARAM, r.name);
      for (const [key, value] of Object.entries(r.params)) {
        if (value !== "") url.searchParams.set(PARAM_PREFIX + key, value);
      }
    }
    const href = url.toString();
    if (href === location.href) return;
    if (mode === "push") history.pushState(history.state, "", href);
    else history.replaceState(history.state, "", href);
  } catch {
    // URL manipulation must never break the app.
  }
}
