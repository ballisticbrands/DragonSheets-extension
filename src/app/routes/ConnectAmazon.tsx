/**
 * Connect Amazon (route: connect-amazon) — Seller Central + Ads connect cards.
 *
 * Popup contract:
 *  1. backend.start*Connect() returns a consent `url`
 *     (mock: our web-accessible mock-oauth.html; real: `authorization_url`
 *     from POST /v1/connect/amazon-selling-partner/start).
 *  2. window.open() that url in a small centered popup.
 *  3. The result comes back by one of TWO routes, because the mock and the
 *     real backend land in different places:
 *       · mock  — the popup postMessages {type:"dragonbot-oauth-result"} to
 *         window.opener and closes itself.
 *       · real  — the backend bounces the popup to
 *         https://go.getdragonsheets.com/oauth-complete/, which is
 *         `externally_connectable` and messages the service worker; the SW
 *         re-broadcasts to us as MSG.oauthResultBroadcast.
 *     Both are handled; neither is trusted as the source of truth.
 *  4. We reconcile from *connection status*, never from the message alone
 *     (DRAGONSHEETS_PLAN Phase 5 principle). The message triggers a re-read
 *     and a reconcile; it never fires an analytics event itself.
 *  5. Belt and braces: refocusing the sheet also re-reads connections, so a
 *     popup that was blocked, closed early, or never bounced back still
 *     resolves the moment the user comes back to the tab.
 */
import { useCallback, useEffect, useState } from "react";
import { reconcileConnectionActivations } from "../../analytics";
import { getBackend } from "../../backend";
import type { ConnectProvider, ConnectionStatus } from "../../backend/types";
import { MSG } from "../../lib/messages";
import { Badge, Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import type { AppContext } from "../App";

const OAUTH_RESULT_TYPE = "dragonbot-oauth-result";

interface OauthResultMessage {
  type: typeof OAUTH_RESULT_TYPE;
  provider: ConnectProvider;
  status: "success" | "error";
}

function isOauthResult(data: unknown): data is OauthResultMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === OAUTH_RESULT_TYPE
  );
}

function openCenteredPopup(url: string): WindowProxy | null {
  const w = 460;
  const h = 620;
  const left = Math.round(window.screenX + (window.innerWidth - w) / 2);
  const top = Math.round(window.screenY + Math.max(0, (window.innerHeight - h) / 3));
  return window.open(url, "dragonsheets-oauth", `width=${w},height=${h},left=${left},top=${top}`);
}

export function ConnectAmazon({ ctx }: { ctx: AppContext }) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [pending, setPending] = useState<ConnectProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConn(await getBackend().getConnectionStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Listen for the popup's postMessage result.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!isOauthResult(e.data)) return;
      // Mock popup is an extension page; the real consent callback page will
      // be on api.getdragonbot.com — accept both, reject everything else.
      const okOrigin =
        e.origin.startsWith("chrome-extension://") ||
        e.origin === "https://api.getdragonbot.com";
      if (!okOrigin) return;
      void (async () => {
        if (e.data.status === "success") {
          await getBackend().completeConnect(e.data.provider);
        }
        setPending(null);
        await refresh();
        // Reconcile straight away so the conversion is not held hostage until
        // the next sidebar mount. It still reads connection STATE and dedupes
        // per connection id — this is a latency optimisation, not a second
        // firing path.
        void reconcileConnectionActivations();
        // 🚫 Deliberately NO direct event fire from this postMessage. A popup
        // that is blocked, closed a second early, or navigated away from still
        // leaves a real server-side connection, and a postMessage-only path
        // drops that conversion silently — it cost DragonReply its first real
        // connection. See src/analytics/events.ts.
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  // Real path: the service worker relays the /oauth-complete/ bounce page's
  // message. Same discipline as above — re-read state, never trust the nudge.
  useEffect(() => {
    const onRuntimeMessage = (message: unknown) => {
      if ((message as { type?: string } | null)?.type !== MSG.oauthResultBroadcast) return;
      void (async () => {
        setPending(null);
        await refresh();
        void reconcileConnectionActivations();
      })();
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  }, [refresh]);

  // Safety net: a consent popup can end without ever reaching us (blocked,
  // closed early, or bounced somewhere that can't message the extension). The
  // connection still exists server-side, so re-read whenever the user returns
  // to the sheet rather than leaving the card stuck on "Waiting for Amazon…".
  useEffect(() => {
    const onFocus = () => {
      void (async () => {
        await refresh();
        void reconcileConnectionActivations();
      })();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const connect = async (provider: ConnectProvider) => {
    setPending(provider);
    setError(null);
    try {
      const backend = getBackend();
      const start =
        provider === "amazon-selling-partner"
          ? await backend.startSpApiConnect()
          : await backend.startAdsConnect();
      const popup = openCenteredPopup(start.url);
      if (!popup) setPending(null); // popup blocked
    } catch (err) {
      // The backend's `error` sentence is written for a seller — show it.
      setError(err instanceof Error ? err.message : String(err));
      setPending(null);
    }
  };

  const cards: Array<{
    provider: ConnectProvider;
    title: string;
    description: string;
    state: ConnectionStatus["sellerCentral"] | undefined;
  }> = [
    {
      provider: "amazon-selling-partner",
      title: "Seller Central",
      description: "Orders, inventory, fees, returns, sales & traffic.",
      state: conn?.sellerCentral,
    },
    {
      provider: "amazon-ads",
      title: "Amazon Ads",
      description: "Sponsored Products, Brands & Display — down to search terms.",
      state: conn?.ads,
    },
  ];

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div>
        <button className="text-[12px] text-ink/40 hover:text-ink" onClick={() => ctx.navigate("home")}>
          ‹ Home
        </button>
        <h1 className="mt-1 text-[18px] font-bold tracking-tight text-ink">Connect Amazon</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink/60">
          Approval happens on Amazon's own consent page — DragonSheets never
          sees your Amazon password.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] leading-relaxed text-red-700">
          {error}
        </p>
      ) : null}

      {cards.map((c) => {
        const connected = c.state?.state === "connected";
        const isPending = pending === c.provider;
        return (
          <Card key={c.provider}>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-ink">{c.title}</span>
              {connected ? <Badge tone="lime">Connected</Badge> : <Badge tone="gray">Not connected</Badge>}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink/60">{c.description}</p>
            {connected && c.state?.accountName ? (
              <p className="mt-1 text-[12px] font-medium text-deep">{c.state.accountName}</p>
            ) : null}
            <div className="mt-3">
              {/* Offered even when this provider already has a connection: a
                  seller can own several Seller Central or Ads accounts, and
                  Settings' "+ Add another Amazon account" lands here — with the
                  button hidden it was a dead end. */}
              <Button variant="secondary" disabled={isPending} onClick={() => void connect(c.provider)}>
                {isPending ? <Spinner /> : null}
                {isPending ? "Waiting for Amazon…" : connected ? "Connect another" : "Connect"}
              </Button>
            </div>
          </Card>
        );
      })}

      <Button variant="ghost" onClick={() => ctx.navigate("home")}>
        Done
      </Button>
    </div>
  );
}
