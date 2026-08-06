/**
 * SidebarApp — the React app mounted inside the Shadow DOM root.
 * Fixed right-side panel (~360px, drag-to-resize on the left edge — the
 * affordance hopted lacks), toggled by the toolbar launcher.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getBackend } from "../backend";
import type { Session } from "../backend/types";
import { sidebarStore } from "../content/sidebar-store";
import { getSpreadsheetId, type SelectorMap } from "../content/selector-map";
import {
  readRouteFromUrl,
  sameRoute,
  toRoute,
  writeRouteToUrl,
  type Route,
  type RouteLike,
} from "./router";
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
      className="fixed right-0 top-0 flex h-screen flex-col border-l border-gray-200 bg-white font-sans text-ink shadow-2xl"
      style={{ width }}
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
      <div ref={bodyRef} className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
        {!booted || !route ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size={22} />
          </div>
        ) : (
          <Screen route={route} ctx={ctx} />
        )}
      </div>
      <div className="border-t border-gray-100 px-4 py-2 text-center text-[11px] text-ink/30">
        Mock mode — no data leaves this browser yet
      </div>
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
