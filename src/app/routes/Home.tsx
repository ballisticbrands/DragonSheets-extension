/** Home — post-onboarding hub (route: home). */
import { useEffect, useState } from "react";
import { getBackend } from "../../backend";
import type { ConnectionStatus, Usage } from "../../backend/types";
import { Badge, Card } from "../../ui/Card";
import type { AppContext } from "../App";
import type { RouteName } from "../router";

const NAV: Array<{ route: RouteName; title: string; description: string }> = [
  { route: "agent", title: "AI Agent", description: "Describe the sheet you want — it drafts the sync" },
  { route: "templates", title: "Templates", description: "P&L by SKU, TACOS, restock and more" },
  { route: "syncs", title: "Syncs", description: "Live data syncs into this spreadsheet" },
  { route: "settings", title: "Settings", description: "Accounts, plan and usage" },
];

export function Home({ ctx }: { ctx: AppContext }) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    const backend = getBackend();
    // Both lines here are decorative; a failed read hides its own line rather
    // than producing an unhandled rejection in the console.
    void backend.getConnectionStatus().then(setConn, () => setConn(null));
    void backend.getUsage().then(setUsage, () => setUsage(null));
  }, []);

  const amazonConnected =
    conn !== null &&
    (conn.sellerCentral.state === "connected" || conn.ads.state === "connected");

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div>
        <h1 className="text-[17px] font-bold tracking-tight text-ink">
          {ctx.session ? `Hey, ${ctx.session.name.split(" ")[0]}` : "Welcome back"}
        </h1>
        <p className="mt-0.5 text-[12.5px] text-ink/50">{ctx.session?.email}</p>
      </div>

      {!amazonConnected ? (
        <Card interactive onClick={() => ctx.navigate("connect-amazon")} className="border-forest/30 bg-forest/5">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-ink">Connect Amazon</span>
            <Badge>1 step left</Badge>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink/60">
            Link Seller Central and Ads so your reports have data to pull from.
          </p>
        </Card>
      ) : (
        <Card className="border-lime/50 bg-lime/10">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-deep">Amazon connected</span>
            <button
              className="text-[12px] font-medium text-forest underline underline-offset-2"
              onClick={() => ctx.navigate("connect-amazon")}
            >
              Manage
            </button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {NAV.map((n) => (
          <Card key={n.route} interactive onClick={() => ctx.navigate(n.route)}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13.5px] font-semibold text-ink">{n.title}</div>
                <div className="mt-0.5 text-[12px] text-ink/50">{n.description}</div>
              </div>
              <span className="text-ink/30">›</span>
            </div>
          </Card>
        ))}
      </div>

      {usage ? (
        <p className="text-center text-[11px] text-ink/40">
          {usage.plan === "free" ? "Free plan" : "Pro plan"} · {usage.syncsUsed}/
          {usage.syncsLimit} syncs · {usage.accountsUsed}/{usage.accountsLimit} Amazon accounts
        </p>
      ) : null}
    </div>
  );
}
