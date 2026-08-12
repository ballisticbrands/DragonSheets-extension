/**
 * SidebarApp — the React app mounted inside the Shadow DOM root.
 * Fixed right-side panel (~360px, drag-to-resize on the left edge — the
 * affordance hopted lacks), toggled by the toolbar launcher.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { reconcileConnectionActivations, trackSidebarOpened } from "../analytics";
import { getBackend, getBackendMode } from "../backend";
import type { Session } from "../backend/types";
import { sidebarStore } from "../content/sidebar-store";
import { getSpreadsheetId, type SelectorMap } from "../content/selector-map";
import { TOP_OFFSET_VAR } from "../content/top-offset";
import {
  readRouteFromUrl,
  sameRoute,
  toRoute,
  writeRouteToUrl,
  type Route,
  type RouteLike,
  type RouteName,
} from "./router";
import { checkAccess } from "../backend/sheet-access";
import { logDiag } from "../lib/diagnostics";
import { Welcome } from "./routes/Welcome";
import { ShareSpreadsheet } from "./routes/ShareSpreadsheet";
import { OnboardingCompleted } from "./routes/OnboardingCompleted";
import { Home } from "./routes/Home";
import { ConnectAmazon } from "./routes/ConnectAmazon";
import { Syncs } from "./routes/syncs/Syncs";
import { SyncWizard } from "./routes/syncs/SyncWizard";
import { SyncDetail } from "./routes/syncs/SyncDetail";
import { Agent } from "./routes/Agent";
import { Templates } from "./routes/Templates";
import { Settings } from "./routes/Settings";
import { Spinner } from "../ui/Spinner";

const MIN_WIDTH = 320;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 360;

/**
 * Screens the sharing gate leaves alone.
 *
 *  - `welcome` — you cannot share a sheet with an account you haven't signed
 *    into yet.
 *  - `share-spreadsheet` — the destination; redirecting to it from itself
 *    would just churn history.
 *  - `settings` — the way OUT. Sign-out and the Google tab live there, and a
 *    gate that can lock someone out of Settings is a gate that can lock them
 *    out of the product.
 *
 * Everything else — including a `dsr=` deep link — is gated. The deep-link
 * router itself is untouched: the URL is parsed exactly as before, and this
 * only changes which route wins afterwards.
 */
const GATE_EXEMPT: ReadonlySet<RouteName> = new Set<RouteName>([
  "welcome",
  "share-spreadsheet",
  "settings",
]);

export interface AppContext {
  /** Push a route (adds a browser history entry). */
  navigate: (route: RouteLike) => void;
  /** Mirror a route without a history entry — for sub-state like wizard steps. */
  replace: (route: RouteLike) => void;
  session: Session | null;
  refreshSession: () => Promise<void>;
  spreadsheetId: string;
  selectors: SelectorMap;
  closeSidebar: () => void;
  /** Scroll the sidebar body — screens are taller than the panel. */
  scrollToTop: () => void;
  scrollToBottom: () => void;
}

export function SidebarApp({ selectors }: { selectors: SelectorMap }) {
  const open = useSyncExternalStore(sidebarStore.subscribe, sidebarStore.isOpen);
  const [route, setRoute] = useState<Route | null>(readRouteFromUrl());
  const [session, setSession] = useState<Session | null>(null);
  const [booted, setBooted] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const spreadsheetId = getSpreadsheetId() ?? "unknown";

  const refreshSession = useCallback(async () => {
    const s = await getBackend().getSession();
    setSession(s);
  }, []);

  // Boot: restore session; if a deep link (dsr=) is present, open the sidebar
  // directly on that screen (hopted's support-link trick).
  useEffect(() => {
    void (async () => {
      await refreshSession();
      setBooted(true);
      if (readRouteFromUrl()) sidebarStore.setOpen(true);
    })();
  }, [refreshSession]);

  // Analytics: one `sidebar_opened` per open (not per render), and the
  // activation reconciliation. Activations MUST come from connection state
  // here rather than from the OAuth popup's postMessage — a blocked or
  // early-closed popup would otherwise lose the conversion silently while the
  // connection succeeded server-side. See src/analytics/events.ts.
  const openTracked = useRef(false);
  useEffect(() => {
    if (!open) {
      openTracked.current = false;
      return;
    }
    if (!booted || openTracked.current) return;
    openTracked.current = true;
    void trackSidebarOpened({ source: readRouteFromUrl() ? "deep_link" : "launcher" });
  }, [open, booted]);

  // Reconcile per (open × signed-in user), so a user who signs in with the
  // panel already open still gets reconciled without waiting for a reopen.
  const reconciledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !session) return;
    if (reconciledFor.current === session.userId) return;
    reconciledFor.current = session.userId;
    void reconcileConnectionActivations();
  }, [open, session]);

  // Back/forward inside the extension UI.
  useEffect(() => {
    const onPop = () => setRoute(readRouteFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Escape closes (hopted behaviour).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sidebarStore.isOpen()) closeSidebar();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((r: RouteLike) => {
    const next = toRoute(r);
    setRoute(next);
    writeRouteToUrl(next, "push");
  }, []);

  const replace = useCallback((r: RouteLike) => {
    const next = toRoute(r);
    setRoute((prev) => (sameRoute(prev, next) ? prev : next));
    writeRouteToUrl(next, "replace");
  }, []);

  const closeSidebar = useCallback(() => {
    sidebarStore.setOpen(false);
    writeRouteToUrl(null, "replace");
  }, []);

  const scrollToTop = useCallback(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // Entry gate (hopted §5.4): choose the screen from state when the panel is
  // opened without a deep link.
  useEffect(() => {
    if (!open || !booted) return;
    if (route) return;
    setRoute(toRoute(session ? "home" : "welcome"));
  }, [open, booted, route, session]);

  // ── the sharing gate ─────────────────────────────────────────────────────
  //
  // A spreadsheet that isn't shared with the service account cannot be written
  // to, so every screen behind this one is decoration. It runs on OPEN rather
  // than once during onboarding, because the bug it fixes is exactly that: the
  // user X'ed out of the share step and had no way back to it.
  //
  // It runs once per open, and only redirects if the user is still on the
  // screen they opened onto — the check is a round trip, and yanking someone
  // out of a screen they navigated to in the meantime would be its own bug.
  //
  // Caching lives in backend/sheet-access.ts: grants are memoised for a few
  // minutes so toggling the pill isn't a network call, denials never are, so
  // sharing the sheet and coming back always works.
  const routeRef = useRef<Route | null>(route);
  routeRef.current = route;
  const gatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !booted || !session) {
      if (!open) gatedFor.current = null;
      return;
    }
    const key = `${session.userId}|${spreadsheetId}`;
    if (gatedFor.current === key) return;
    gatedFor.current = key;
    void (async () => {
      try {
        const res = await checkAccess(spreadsheetId);
        if (res.granted) return;
        if (!sidebarStore.isOpen()) return;
        const current = routeRef.current;
        if (current && GATE_EXEMPT.has(current.name)) return;
        navigate("share-spreadsheet");
      } catch (err) {
        // A transient failure must not strand the user on the share screen
        // with an address they can't verify. Log it and let the normal route
        // stand; the next open re-checks.
        logDiag("sheet-access-gate-failed", { error: String(err) });
      }
    })();
  }, [open, booted, session, spreadsheetId, navigate]);

  // Drag-to-resize.
  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragState.current = { startX: e.clientX, startWidth: width };
      const onMove = (ev: PointerEvent) => {
        if (!dragState.current) return;
        const delta = dragState.current.startX - ev.clientX;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragState.current.startWidth + delta));
        setWidth(next);
      };
      const onUp = () => {
        dragState.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width]
  );

  if (!open) return null;

  const ctx: AppContext = {
    navigate,
    replace,
    session,
    refreshSession,
    spreadsheetId,
    selectors,
    closeSidebar,
    scrollToTop,
    scrollToBottom,
  };

  return (
    <div
      className="fixed right-0 flex flex-col border-l border-gray-200 bg-white font-sans text-ink shadow-2xl"
      // Not `top-0 h-screen`: that laid the panel over Google's title bar and
      // toolbar, hiding the Share button this product's own onboarding tells
      // the user to click. `--ds-top-offset` is measured from Google's chrome
      // and kept current by content/top-offset.ts; the 0px fallback means a
      // missing var degrades to the old full-height panel rather than to a
      // zero-height one.
      style={{
        width,
        top: `var(${TOP_OFFSET_VAR}, 0px)`,
        height: `calc(100vh - var(${TOP_OFFSET_VAR}, 0px))`,
      }}
    >
      {/* resize handle */}
      <div
        className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-forest/20"
        onPointerDown={onDragStart}
        title="Drag to resize"
      />
      {/* header */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-forest text-[11px] font-bold text-white">
          DS
        </span>
        <span className="text-[15px] font-semibold tracking-tight">DragonSheets</span>
        <span className="ml-auto" />
        {session ? (
          <button
            className="rounded-md px-2 py-1 text-[12px] text-ink/40 hover:bg-ink/5 hover:text-ink"
            onClick={() => navigate("settings")}
          >
            Settings
          </button>
        ) : null}
        <button
          className="rounded-md px-2 py-1 text-[16px] leading-none text-ink/40 hover:bg-ink/5 hover:text-ink"
          onClick={closeSidebar}
          aria-label="Close DragonSheets"
        >
          ×
        </button>
      </div>
      {/* body */}
      {/* `min-h-0` so the scroll container actually clips: a flex child
          defaults to min-height:auto and would otherwise grow past the
          panel's now-shorter height instead of scrolling inside it. */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        {!booted || !route ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size={22} />
          </div>
        ) : (
          <Screen route={route} ctx={ctx} />
        )}
      </div>
      {/* Mode banner. It disappears in real mode rather than lying about
          where the data comes from — the seam is src/backend/index.ts. */}
      {getBackendMode() === "mock" ? (
        <div className="border-t border-gray-100 px-4 py-2 text-center text-[11px] text-ink/30">
          Mock mode — no data leaves this browser yet
        </div>
      ) : null}
    </div>
  );
}

function Screen({ route, ctx }: { route: Route; ctx: AppContext }) {
  switch (route.name) {
    case "welcome":
      return <Welcome ctx={ctx} />;
    case "share-spreadsheet":
      return <ShareSpreadsheet ctx={ctx} />;
    case "onboarding-completed":
      return <OnboardingCompleted ctx={ctx} />;
    case "home":
      return <Home ctx={ctx} />;
    case "connect-amazon":
      return <ConnectAmazon ctx={ctx} />;
    case "syncs":
      return <Syncs ctx={ctx} />;
    case "sync-new":
      // Remount on prefill change so the wizard re-materialises the draft.
      return (
        <SyncWizard
          key={`${route.params.template ?? ""}|${route.params.proposal ?? ""}`}
          ctx={ctx}
          params={route.params}
        />
      );
    case "sync-detail":
      return <SyncDetail key={route.params.id ?? ""} ctx={ctx} params={route.params} />;
    case "agent":
      return <Agent ctx={ctx} />;
    case "templates":
      return <Templates ctx={ctx} params={route.params} />;
    case "settings":
      return <Settings ctx={ctx} params={route.params} />;
  }
}
