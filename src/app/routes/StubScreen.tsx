/** Placeholder for screens the next build phase fills in (Syncs wizard, AI
 * agent chat, template gallery, settings). Keeps navigation honest today. */
import { useEffect, useState } from "react";
import { getBackend } from "../../backend";
import type { ConnectionStatus } from "../../backend/types";
import { Badge, Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import type { AppContext } from "../App";

export function StubScreen({
  ctx,
  title,
  description,
  showConnections = false,
}: {
  ctx: AppContext;
  title: string;
  description: string;
  showConnections?: boolean;
}) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    if (showConnections) void getBackend().getConnectionStatus().then(setConn);
  }, [showConnections]);

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div>
        <button className="text-[12px] text-ink/40 hover:text-ink" onClick={() => ctx.navigate("home")}>
          ‹ Home
        </button>
        <h1 className="mt-1 text-[18px] font-bold tracking-tight text-ink">{title}</h1>
      </div>
      <Card className="border-dashed">
        <div className="flex items-center gap-2">
          <Badge>Coming online</Badge>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink/60">{description}</p>
      </Card>
      {showConnections && conn ? (
        <Card>
          <div className="text-[13px] font-semibold text-ink">Connected accounts</div>
          <ul className="mt-2 flex flex-col gap-1 text-[12.5px] text-ink/60">
            <li>
              Seller Central —{" "}
              {conn.sellerCentral.state === "connected"
                ? conn.sellerCentral.accountName ?? "connected"
                : "not connected"}
            </li>
            <li>
              Amazon Ads —{" "}
              {conn.ads.state === "connected" ? conn.ads.accountName ?? "connected" : "not connected"}
            </li>
          </ul>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => ctx.navigate("connect-amazon")}>
              Manage connections
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
