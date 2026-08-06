/**
 * Settings (route: settings, `dsp-tab=<tab>`) — the in-sheet settings surface.
 * Sections mirror hopted's split (teardown §6.7): integrations, workspace
 * members, plan/usage, plus the two things unique to our architecture (the
 * Google sheet-access check) and the CWS-required about/links block.
 */
import { useCallback, useEffect, useState } from "react";
import { getBackend } from "../../backend";
import type {
  ConnectProvider,
  ConnectionStatus,
  Usage,
  WorkspaceMember,
} from "../../backend/types";
import { formatDate, formatNumber, relativeTime } from "../../lib/format";
import { Badge, Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { CopyButton } from "../../ui/CopyButton";
import { Spinner } from "../../ui/Spinner";
import { Meter, ScreenHeader, Tabs } from "../../ui/Screen";
import type { AppContext } from "../App";
import { route } from "../router";

const TABS = [
  { id: "accounts", label: "Accounts" },
  { id: "google", label: "Google" },
  { id: "plan", label: "Plan" },
  { id: "members", label: "Members" },
  { id: "about", label: "About" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTab(v: string | undefined): v is TabId {
  return v !== undefined && TABS.some((t) => t.id === v);
}

const SUPPORT_EMAIL = "support@getdragonsheets.com";
const PRIVACY_URL = "https://go.getdragonsheets.com/privacy/";

export function Settings({ ctx, params }: { ctx: AppContext; params: Record<string, string> }) {
  const [tab, setTab] = useState<TabId>(isTab(params.tab) ? params.tab : "accounts");

  const pick = (next: TabId) => {
    setTab(next);
    ctx.replace(route("settings", { tab: next }));
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <ScreenHeader title="Settings" backLabel="Home" onBack={() => ctx.navigate("home")} />
      <Tabs tabs={TABS} active={tab} onChange={pick} label="Settings sections" />
      {tab === "accounts" ? <AccountsTab ctx={ctx} /> : null}
      {tab === "google" ? <GoogleTab ctx={ctx} /> : null}
      {tab === "plan" ? <PlanTab /> : null}
      {tab === "members" ? <MembersTab /> : null}
      {tab === "about" ? <AboutTab /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AccountsTab({ ctx }: { ctx: AppContext }) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState<ConnectProvider | null>(null);
  const [confirm, setConfirm] = useState<ConnectProvider | null>(null);

  const refresh = useCallback(async () => {
    setConn(await getBackend().getConnectionStatus());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const disconnect = async (provider: ConnectProvider) => {
    setBusy(provider);
    try {
      await getBackend().disconnect(provider);
      setConfirm(null);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (!conn) {
    return (
      <div className="flex h-20 items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  }

  const cards: Array<{ provider: ConnectProvider; title: string; state: ConnectionStatus["ads"] }> = [
    { provider: "amazon-selling-partner", title: "Seller Central", state: conn.sellerCentral },
    { provider: "amazon-ads", title: "Amazon Ads", state: conn.ads },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      {cards.map((c) => {
        const connected = c.state.state === "connected";
        return (
          <Card key={c.provider}>
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-ink">{c.title}</span>
              {connected ? <Badge tone="lime">Connected</Badge> : <Badge tone="gray">Not connected</Badge>}
            </div>
            {connected ? (
              <p className="mt-1 text-[12px] text-ink/60">
                {c.state.accountName}
                {c.state.connectedAt ? ` · linked ${relativeTime(c.state.connectedAt)}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-ink/50">
                Link it to unlock the matching reports in the sync wizard.
              </p>
            )}
            <div className="mt-2.5 flex items-center gap-1.5">
              <Button
                variant="secondary"
                className="px-2.5 py-1.5 text-[11px]"
                onClick={() => ctx.navigate("connect-amazon")}
              >
                {connected ? "Reconnect" : "Connect"}
              </Button>
              {connected ? (
                confirm === c.provider ? (
                  <>
                    <span className="text-[11px] text-ink/50">Disconnect?</span>
                    <Button
                      variant="danger"
                      className="px-2.5 py-1.5 text-[11px]"
                      disabled={busy === c.provider}
                      onClick={() => void disconnect(c.provider)}
                    >
                      {busy === c.provider ? <Spinner size={12} /> : null}
                      Yes
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1.5 text-[11px]"
                      onClick={() => setConfirm(null)}
                    >
                      No
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    className="px-2.5 py-1.5 text-[11px]"
                    onClick={() => setConfirm(c.provider)}
                  >
                    Disconnect
                  </Button>
                )
              ) : null}
            </div>
          </Card>
        );
      })}
      <Button variant="ghost" className="w-full" onClick={() => ctx.navigate("connect-amazon")}>
        + Add another Amazon account
      </Button>
      <p className="text-[11px] leading-relaxed text-ink/40">
        Disconnecting stops future refreshes. Data already written to your sheet
        stays where it is.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function GoogleTab({ ctx }: { ctx: AppContext }) {
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void getBackend().getServiceAccountEmail().then(setEmail);
  }, []);

  const recheck = async () => {
    setChecking(true);
    try {
      const res = await getBackend().checkSheetAccess(ctx.spreadsheetId);
      setGranted(res.granted);
      setCheckedAt(res.checkedAt);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <Card>
        <div className="text-[13.5px] font-semibold text-ink">Google account</div>
        <p className="mt-1 text-[12px] text-ink/60">
          {ctx.session ? `${ctx.session.name} — ${ctx.session.email}` : "Not signed in"}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink/40">
          DragonSheets holds no Google Sheets or Drive permission. It reads and
          writes only the spreadsheets you share with the writer address below.
        </p>
      </Card>

      <Card>
        <div className="text-[13.5px] font-semibold text-ink">Sheet access</div>
        <div className="mt-2 rounded-xl border border-forest/20 bg-forest/5 p-2.5">
          <div className="break-all font-mono text-[11.5px] text-deep">{email || "…"}</div>
          <div className="mt-2">
            <CopyButton value={email} label="Copy email" />
          </div>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink/50">
          This spreadsheet: <span className="font-mono">{ctx.spreadsheetId.slice(0, 12)}…</span>
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" className="px-3 py-1.5 text-[11.5px]" disabled={checking} onClick={() => void recheck()}>
            {checking ? <Spinner size={12} /> : null}
            {checking ? "Checking…" : "Re-check access"}
          </Button>
          {granted !== null && checkedAt !== null ? (
            <span className="text-[11.5px] text-forest">
              {granted ? "Access confirmed" : "No access"} · {relativeTime(checkedAt)}
            </span>
          ) : null}
        </div>
      </Card>

      <Button variant="ghost" className="w-full" onClick={() => void getBackend().signOut().then(() => ctx.navigate("welcome"))}>
        Sign out
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlanTab() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [upgradeNote, setUpgradeNote] = useState(false);

  useEffect(() => {
    void getBackend().getUsage().then(setUsage);
  }, []);

  if (!usage) {
    return (
      <div className="flex h-20 items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-ink">
            {usage.plan === "pro" ? "Pro" : "Free"} plan
          </span>
          {usage.plan === "free" ? <Badge tone="gray">Limited</Badge> : <Badge tone="lime">Active</Badge>}
        </div>
        <p className="mt-1 text-[11.5px] text-ink/50">
          Usage resets {formatDate(usage.periodResetsAt)}.
        </p>
        <div className="mt-3 flex flex-col gap-2.5">
          <UsageRow label="Syncs" used={usage.syncsUsed} limit={usage.syncsLimit} />
          <UsageRow label="Amazon accounts" used={usage.accountsUsed} limit={usage.accountsLimit} />
          <UsageRow label="Rows written" used={usage.rowsUsed} limit={usage.rowsLimit} />
        </div>
      </Card>

      <Card className="border-forest/30 bg-forest/5">
        <div className="text-[13px] font-semibold text-deep">Pro</div>
        <ul className="mt-1.5 flex flex-col gap-1 text-[11.5px] text-ink/70">
          <li>15-minute and hourly refresh</li>
          <li>Unlimited syncs and blended reports</li>
          <li>More Amazon accounts and marketplaces</li>
        </ul>
        <div className="mt-3">
          {/* TODO(billing): wire to the real checkout once Phase 8 billing lands
              (DRAGONSHEETS_PLAN Phase 8). Deliberately a no-op today — there is
              nothing to charge against yet. */}
          <Button className="w-full" onClick={() => setUpgradeNote(true)}>
            Upgrade to Pro
          </Button>
          {upgradeNote ? (
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink/50">
              Billing isn't live yet — nothing was charged and nothing changed.
              We'll turn this on with the real backend.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const near = limit > 0 && used / limit >= 0.8;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-ink/70">{label}</span>
        <span className={near ? "font-semibold text-[#F59E0B]" : "text-ink/50"}>
          {formatNumber(used)} / {formatNumber(limit)}
        </span>
      </div>
      <div className="mt-1">
        <Meter value={used} max={limit} tone={near ? "amber" : "forest"} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MembersTab() {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);

  useEffect(() => {
    void getBackend().listWorkspaceMembers().then(setMembers);
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      <Card>
        <div className="text-[13.5px] font-semibold text-ink">Workspace members</div>
        {members === null ? (
          <div className="mt-3 flex justify-center">
            <Spinner size={18} />
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-ink">{m.name}</span>
                  <span className="block truncate text-[11px] text-ink/40">{m.email}</span>
                </span>
                <Badge tone={m.status === "active" ? "forest" : "gray"}>{m.role}</Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Button variant="secondary" className="w-full" disabled>
            Invite a teammate
          </Button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink/40">
            Coming soon. Until then, anyone with edit access to this spreadsheet
            sees the data your syncs write.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AboutTab() {
  const manifest = chrome.runtime.getManifest();
  const issueBody = encodeURIComponent(
    `\n\n---\nVersion: ${manifest.version}\nBackend: mock\nUser agent: ${navigator.userAgent}`
  );
  return (
    <div className="flex flex-col gap-2.5">
      <Card>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest text-[12px] font-bold text-white">
            DS
          </span>
          <div>
            <div className="text-[13.5px] font-semibold text-ink">DragonSheets</div>
            <div className="text-[11.5px] text-ink/50">v{manifest.version} · mock backend</div>
          </div>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink/50">
          Amazon Seller Central and Ads data, live in the sheet you're already
          working in.
        </p>
      </Card>

      <Card>
        <ul className="flex flex-col gap-2 text-[12.5px]">
          <li>
            <a className="text-forest underline underline-offset-2" href={PRIVACY_URL} target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          </li>
          <li>
            <a
              className="text-forest underline underline-offset-2"
              href={`mailto:${SUPPORT_EMAIL}`}
              target="_blank"
              rel="noreferrer"
            >
              Contact support
            </a>
          </li>
          <li>
            <a
              className="text-forest underline underline-offset-2"
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                `DragonSheets issue (v${manifest.version})`
              )}&body=${issueBody}`}
              target="_blank"
              rel="noreferrer"
            >
              Report an issue
            </a>
          </li>
        </ul>
      </Card>

      <p className="text-[11px] leading-relaxed text-ink/40">
        Mock mode: everything on these screens is generated locally and stored in
        this browser. No data leaves your machine yet.
      </p>
    </div>
  );
}
