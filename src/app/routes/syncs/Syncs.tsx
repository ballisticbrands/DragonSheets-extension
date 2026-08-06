/**
 * Syncs list (route: syncs) — every live data sync in this workspace, with
 * run-now / pause / delete inline. Empty state pushes straight into the
 * wizard, which is where activation actually happens.
 */
import { useCallback, useEffect, useState } from "react";
import { getBackend } from "../../../backend";
import type { ReportCatalogEntry, Sync } from "../../../backend/types";
import { formatNumber, relativeTime } from "../../../lib/format";
import { Badge, Card } from "../../../ui/Card";
import { Button } from "../../../ui/Button";
import { Spinner } from "../../../ui/Spinner";
import { EmptyState, ScreenHeader } from "../../../ui/Screen";
import type { AppContext } from "../../App";
import { route } from "../../router";
import { findReport, scheduleLabel } from "./model";

export function Syncs({ ctx }: { ctx: AppContext }) {
  const [syncs, setSyncs] = useState<Sync[] | null>(null);
  const [reports, setReports] = useState<ReportCatalogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSyncs(await getBackend().listSyncs());
  }, []);

  useEffect(() => {
    void getBackend().listReports().then(setReports);
    void refresh();
  }, [refresh]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <ScreenHeader
        title="Live Data Syncs"
        backLabel="Home"
        onBack={() => ctx.navigate("home")}
        subtitle="Each sync owns a tab in this spreadsheet and keeps it current on its own."
        action={
          syncs && syncs.length > 0 ? (
            <Button variant="secondary" className="px-3 py-1.5 text-[11.5px]" onClick={() => ctx.navigate("sync-new")}>
              + New
            </Button>
          ) : null
        }
      />

      {syncs === null ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner size={20} />
        </div>
      ) : syncs.length === 0 ? (
        <EmptyState
          title="No syncs yet"
          description="Pick your reports and columns once. After that the sheet refills itself on a schedule — no more CSV exports."
          action={<Button onClick={() => ctx.navigate("sync-new")}>New Live Data Sync</Button>}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {syncs.map((s) => {
            const running = busy === s.id;
            const reportNames = s.sources
              .map((src) => findReport(reports, src.reportId)?.name ?? src.reportId)
              .join(", ");
            return (
              <Card key={s.id}>
                <button
                  className="w-full text-left focus:outline-none focus:ring-2 focus:ring-forest/30"
                  onClick={() => ctx.navigate(route("sync-detail", { id: s.id }))}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">{s.name}</span>
                    <StatusBadge sync={s} running={running} />
                  </div>
                  <div className="mt-1 text-[11.5px] leading-snug text-ink/50">{reportNames}</div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-ink/50">
                    <span>Tab: {s.sheetName}</span>
                    <span>{scheduleLabel(s.schedule)}</span>
                    <span>
                      {s.lastRunAt ? `${relativeTime(s.lastRunAt)} · ${formatNumber(s.rowCount)} rows` : "never run"}
                    </span>
                  </div>
                </button>
                <div className="mt-2.5 flex items-center gap-1.5 border-t border-gray-100 pt-2.5">
                  <Button
                    variant="secondary"
                    className="px-2.5 py-1.5 text-[11px]"
                    disabled={running}
                    onClick={() => void act(s.id, () => getBackend().runSync(s.id))}
                  >
                    {running ? <Spinner size={12} /> : null}
                    {running ? "Running" : "Run now"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2.5 py-1.5 text-[11px]"
                    disabled={running}
                    onClick={() => void act(s.id, () => getBackend().setSyncPaused(s.id, !s.paused))}
                  >
                    {s.paused ? "Resume" : "Pause"}
                  </Button>
                  <div className="ml-auto">
                    {confirmDelete === s.id ? (
                      <span className="flex items-center gap-1.5">
                        <span className="text-[11px] text-ink/50">Delete?</span>
                        <Button
                          variant="danger"
                          className="px-2.5 py-1.5 text-[11px]"
                          onClick={() =>
                            void act(s.id, async () => {
                              await getBackend().deleteSync(s.id);
                              setConfirmDelete(null);
                            })
                          }
                        >
                          Yes
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5 text-[11px]"
                          onClick={() => setConfirmDelete(null)}
                        >
                          No
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        className="px-2.5 py-1.5 text-[11px]"
                        disabled={running}
                        onClick={() => setConfirmDelete(s.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {syncs && syncs.length > 0 ? (
        <p className="text-center text-[11px] text-ink/40">
          Deleting a sync leaves the data already in the sheet untouched.
        </p>
      ) : null}
    </div>
  );
}

export function StatusBadge({ sync, running }: { sync: Sync; running?: boolean }) {
  if (running || sync.status === "running") return <Badge>Running</Badge>;
  if (sync.paused) return <Badge tone="gray">Paused</Badge>;
  if (sync.status === "error") return <Badge tone="gray">Failed</Badge>;
  if (sync.status === "ok") return <Badge tone="lime">Healthy</Badge>;
  return <Badge tone="gray">Not run yet</Badge>;
}
