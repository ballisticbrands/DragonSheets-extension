/**
 * Single sync (route: sync-detail, `dsp-id=<syncId>`) — the read-only overview
 * hopted calls `sync-info`, plus the two things worth editing after creation:
 * the refresh schedule and the calculated columns.
 */
import { useCallback, useEffect, useState } from "react";
import { getBackend } from "../../../backend";
import type { CalculatedColumn, ReportCatalogEntry, Sync, SyncRun } from "../../../backend/types";
import { validateFormula } from "../../../lib/formula";
import { formatClock, formatNumber, relativeTime } from "../../../lib/format";
import { Badge, Card } from "../../../ui/Card";
import { Button } from "../../../ui/Button";
import { Select } from "../../../ui/Field";
import { Spinner } from "../../../ui/Spinner";
import { EmptyState, ScreenHeader } from "../../../ui/Screen";
import type { AppContext } from "../../App";
import { CalculatedColumnsEditor } from "./CalculatedColumnsEditor";
import { StatusBadge } from "./Syncs";
import {
  columnLabel,
  dateRangeLabel,
  findReport,
  formulaFields,
  joinKeyLabel,
  SCHEDULE_OPTIONS,
} from "./model";
import type { SyncSchedule } from "../../../backend/types";

export function SyncDetail({ ctx, params }: { ctx: AppContext; params: Record<string, string> }) {
  const syncId = params.id ?? "";
  const [sync, setSync] = useState<Sync | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [reports, setReports] = useState<ReportCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [draftCalcs, setDraftCalcs] = useState<CalculatedColumn[]>([]);
  const [draftSchedule, setDraftSchedule] = useState<SyncSchedule>("daily");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const backend = getBackend();
    const [s, r, rep] = await Promise.all([
      backend.getSync(syncId),
      backend.listSyncRuns(syncId),
      backend.listReports(),
    ]);
    setSync(s);
    setRuns(r);
    setReports(rep);
    if (s) {
      setDraftCalcs(s.calculatedColumns);
      setDraftSchedule(s.schedule);
    }
    setLoading(false);
  }, [syncId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  if (!sync) {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <ScreenHeader title="Sync not found" backLabel="Syncs" onBack={() => ctx.navigate("syncs")} />
        <EmptyState
          title="That sync is gone"
          description="It was deleted, or the link points at a sync from another spreadsheet."
          action={<Button onClick={() => ctx.navigate("syncs")}>Back to syncs</Button>}
        />
      </div>
    );
  }

  const fields = formulaFields(reports, sync.columns, []);
  const dirty =
    draftSchedule !== sync.schedule ||
    JSON.stringify(draftCalcs) !== JSON.stringify(sync.calculatedColumns);
  const invalidCalc = draftCalcs.some(
    (c) =>
      c.name.trim() === "" ||
      (c.kind === "formula" && !validateFormula(c.formula ?? "", fields).ok)
  );

  const runNow = async () => {
    setRunning(true);
    try {
      await getBackend().runSync(sync.id);
      await load();
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await getBackend().updateSync(sync.id, {
        calculatedColumns: draftCalcs.map((c) => ({ ...c, name: c.name.trim() })),
        schedule: draftSchedule,
      });
      await load();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <ScreenHeader
        title={sync.name}
        backLabel="Syncs"
        onBack={() => ctx.navigate("syncs")}
        subtitle={`Writes to “${sync.sheetName}” in this spreadsheet.`}
        action={<StatusBadge sync={sync} running={running} />}
      />

      <Card>
        <dl className="flex flex-col gap-1.5 text-[12px]">
          <Row label="Reports">
            {sync.sources.map((s) => findReport(reports, s.reportId)?.name ?? s.reportId).join(", ")}
          </Row>
          {sync.joinKeys.length > 0 ? (
            <Row label="Blended on">
              {sync.joinKeys.map((k) => joinKeyLabel(reports, k)).join(" + ")}
            </Row>
          ) : null}
          <Row label="Columns">
            {sync.columns.length} ({sync.columns.slice(0, 4).map((c) => columnLabel(reports, c)).join(", ")}
            {sync.columns.length > 4 ? "…" : ""})
          </Row>
          <Row label="Date range">{dateRangeLabel(sync.dateRange)}</Row>
          <Row label="Filters">{sync.filters.length === 0 ? "None" : `${sync.filters.length} active`}</Row>
          <Row label="Marketplaces">
            {[...new Set(sync.sources.flatMap((s) => s.marketplaceIds))].join(", ") || "—"}
          </Row>
          <Row label="Last run">
            {sync.lastRunAt
              ? `${relativeTime(sync.lastRunAt)} · ${formatNumber(sync.rowCount)} rows`
              : "never"}
          </Row>
        </dl>
      </Card>

      <div className="flex gap-2">
        <Button className="flex-1" disabled={running} onClick={() => void runNow()}>
          {running ? <Spinner size={13} /> : null}
          {running ? "Running…" : "Run now"}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            void getBackend()
              .setSyncPaused(sync.id, !sync.paused)
              .then(load)
          }
        >
          {sync.paused ? "Resume" : "Pause"}
        </Button>
      </div>

      <section>
        <h2 className="text-[12.5px] font-semibold text-ink">Refresh schedule</h2>
        <div className="mt-1.5">
          <Select
            aria-label="Refresh schedule"
            value={draftSchedule}
            onChange={(e) => setDraftSchedule(e.target.value as SyncSchedule)}
          >
            {SCHEDULE_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.requiresPro ? " (Pro)" : ""}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section>
        <h2 className="text-[12.5px] font-semibold text-ink">Calculated columns</h2>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink/50">
          Recomputed on every refresh, so they survive the sheet being rewritten.
        </p>
        <div className="mt-1.5">
          <CalculatedColumnsEditor
            columns={draftCalcs}
            fields={fields}
            onAdd={(c) => setDraftCalcs((prev) => [...prev, c])}
            onUpdate={(c) => setDraftCalcs((prev) => prev.map((x) => (x.id === c.id ? c : x)))}
            onRemove={(id) => setDraftCalcs((prev) => prev.filter((x) => x.id !== id))}
          />
        </div>
      </section>

      {dirty ? (
        <div className="sticky bottom-0 -mx-4 border-t border-gray-100 bg-white/95 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button
              className="flex-1"
              disabled={saving || invalidCalc}
              onClick={() => void save()}
            >
              {saving ? <Spinner size={13} /> : null}
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraftCalcs(sync.calculatedColumns);
                setDraftSchedule(sync.schedule);
              }}
            >
              Discard
            </Button>
          </div>
          {invalidCalc ? (
            <p className="mt-1.5 text-[11.5px] text-red-600">
              Fix the calculated columns above before saving.
            </p>
          ) : null}
        </div>
      ) : saved ? (
        <p className="text-[11.5px] text-forest">Saved. Takes effect on the next run.</p>
      ) : null}

      <section>
        <h2 className="text-[12.5px] font-semibold text-ink">Run history</h2>
        {runs.length === 0 ? (
          <p className="mt-1 text-[12px] text-ink/40">No runs yet.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1">
            {runs.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[11.5px]"
              >
                <span className="flex items-center gap-1.5">
                  <Badge tone={r.status === "ok" ? "lime" : "gray"}>{r.status === "ok" ? "OK" : r.status}</Badge>
                  <span className="text-ink/60">{formatNumber(r.rows)} rows</span>
                </span>
                <span className="text-ink/40">
                  {relativeTime(r.startedAt)} · {formatClock(r.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[86px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink/40">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-ink/80">{children}</dd>
    </div>
  );
}
