/**
 * Live Data Sync wizard (route: sync-new) — six steps, one reducer, a sticky
 * footer. Mirrors hopted's pipeline flow (teardown §6.1): accounts → reports →
 * fields → filters → schedule → success, with the paywall hint surfaced at
 * review rather than as a wall halfway through.
 *
 * Prefill: `dsp-template=<id>` materialises a solution template,
 * `dsp-proposal=<id>` materialises an agent proposal, `dsp-step=<step>` opens
 * on a given step. All three are deep-linkable.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { trackSyncCreated } from "../../../analytics";
import { getBackend } from "../../../backend";
import type { AmazonAccount, ReportCatalogEntry, Sync, SyncRun, Usage } from "../../../backend/types";
import { formatNumber } from "../../../lib/format";
import { Badge, Card } from "../../../ui/Card";
import { Button } from "../../../ui/Button";
import { Spinner } from "../../../ui/Spinner";
import { ScreenHeader } from "../../../ui/Screen";
import type { AppContext } from "../../App";
import { route } from "../../router";
import {
  hydrateFromDraft,
  INITIAL_WIZARD,
  SCHEDULE_OPTIONS,
  STEP_TITLE,
  stepBlocker,
  toSyncConfig,
  wizardReducer,
  WIZARD_STEPS,
  type WizardState,
  type WizardStep,
} from "./model";
import {
  StepAccounts,
  StepColumns,
  StepDestination,
  StepFilters,
  StepReports,
  StepReview,
  type StepProps,
} from "./steps";

type Phase = "form" | "creating" | "done";

const RUN_STAGES = [
  "Authorising with Amazon…",
  "Pulling report rows…",
  "Blending and calculating…",
  "Writing to your sheet…",
];

function isWizardStep(v: string | undefined): v is WizardStep {
  return v !== undefined && (WIZARD_STEPS as readonly string[]).includes(v);
}

/** Tab names straight out of the live Sheets DOM (selector-map owned). */
function readSheetTabs(selector: string): string[] {
  try {
    return [...document.querySelectorAll(selector)]
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => t !== "");
  } catch {
    return [];
  }
}

export function SyncWizard({ ctx, params }: { ctx: AppContext; params: Record<string, string> }) {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD);
  const [reports, setReports] = useState<ReportCatalogEntry[]>([]);
  const [accounts, setAccounts] = useState<AmazonAccount[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("form");
  const [stage, setStage] = useState(0);
  const [created, setCreated] = useState<Sync | null>(null);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const sheetTabs = useMemo(() => readSheetTabs(ctx.selectors.sheetTabName), [ctx.selectors]);
  const templateId = params.template;
  const proposalId = params.proposal;
  const startStep = isWizardStep(params.step) ? params.step : "accounts";

  // Boot: catalog + accounts + usage, then any prefill.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const backend = getBackend();
      // `allSettled`, not `all`: any one of these rejecting used to leave the
      // wizard on its boot spinner forever with an unhandled rejection in the
      // console. A missing catalog is a wizard that can't offer reports — it
      // is not a wizard that never finishes loading.
      const [r, a, u] = await Promise.allSettled([
        backend.listReports(),
        backend.listAccounts(),
        backend.getUsage(),
      ]);
      if (!alive) return;
      if (r.status === "rejected") {
        setError(
          r.reason instanceof Error && r.reason.message
            ? r.reason.message
            : "We couldn't load your report catalog. Try again in a moment."
        );
      }
      const reportList = r.status === "fulfilled" ? r.value : [];
      const accountList = a.status === "fulfilled" ? a.value : [];
      const usageValue = u.status === "fulfilled" ? u.value : null;
      setReports(reportList);
      setAccounts(accountList);
      setUsage(usageValue);

      let hydrated: WizardState | null = null;
      try {
        if (templateId) {
          hydrated = hydrateFromDraft(await backend.materializeTemplate(templateId), accountList, startStep);
        } else if (proposalId) {
          const proposal = await backend.getAgentProposal(proposalId);
          if (proposal) hydrated = hydrateFromDraft(proposal.draft, accountList, startStep);
        }
      } catch {
        hydrated = null;
      }
      if (!alive) return;
      if (hydrated) {
        // A draft may ask for a refresh rate the current plan can't have.
        // Downgrade rather than showing a disabled radio as selected.
        const draftState = hydrated;
        const gated = SCHEDULE_OPTIONS.find((s) => s.id === draftState.schedule)?.requiresPro;
        dispatch({
          type: "hydrate",
          state: gated && usageValue?.plan !== "pro" ? { ...draftState, schedule: "daily" } : draftState,
        });
      } else if (accountList.length > 0) {
        // No prefill: preselect every linked account + its marketplaces so the
        // common single-account case is one click from step 2.
        dispatch({
          type: "hydrate",
          state: {
            ...INITIAL_WIZARD,
            step: startStep,
            accountIds: accountList.map((x) => x.id),
            marketplaceIds: [...new Set(accountList.flatMap((x) => x.marketplaces.map((m) => m.id)))],
          },
        });
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [templateId, proposalId, startStep]);

  // Mirror the step into the URL (replace, so browser Back leaves the wizard
  // rather than crawling back through six history entries).
  useEffect(() => {
    if (loading) return;
    const next: Record<string, string> = { step: state.step };
    if (templateId) next.template = templateId;
    if (proposalId) next.proposal = proposalId;
    ctx.replace(route("sync-new", next));
  }, [state.step, loading, templateId, proposalId, ctx]);

  // Each step starts at the top — the sidebar is short and steps are tall.
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
    ctx.scrollToTop();
  }, [state.step, ctx]);

  const blocker = stepBlocker(state, reports);
  const index = WIZARD_STEPS.indexOf(state.step);
  const isLast = state.step === "review";
  const overLimit = usage !== null && usage.syncsUsed >= usage.syncsLimit;

  const create = useCallback(async () => {
    setError(null);
    setPhase("creating");
    setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(RUN_STAGES.length - 1, s + 1)), 700);
    try {
      const backend = getBackend();
      const sync = await backend.createSync(toSyncConfig(state, reports, accounts));
      setCreated(sync);
      // Shape only — schedule, counts, and where the config came from. No
      // report ids, column names, sheet names or filter values: those describe
      // the customer's business, not our funnel.
      void trackSyncCreated({
        schedule: sync.schedule,
        reportCount: sync.sources.length,
        columnCount: sync.columns.length,
        fromTemplate: Boolean(templateId),
        fromAgent: Boolean(proposalId),
      });
      const firstRun = await backend.runSync(sync.id);
      setRun(firstRun);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creating the sync failed.");
      setPhase("form");
    } finally {
      clearInterval(timer);
    }
  }, [state, reports, accounts, templateId, proposalId]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  if (phase === "creating") {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <ScreenHeader title="Running the first sync" subtitle="This one takes the longest — later refreshes are incremental." />
        <Card>
          <div className="flex flex-col gap-2">
            {RUN_STAGES.map((s, i) => (
              <div key={s} className="flex items-center gap-2 text-[12.5px]">
                {i < stage ? (
                  <span className="text-forest">✓</span>
                ) : i === stage ? (
                  <Spinner size={13} />
                ) : (
                  <span className="text-ink/20">○</span>
                )}
                <span className={i <= stage ? "text-ink" : "text-ink/40"}>{s}</span>
              </div>
            ))}
          </div>
        </Card>
        <p className="text-[11.5px] leading-relaxed text-ink/40">
          You can close the sidebar — the sync runs on our side, not in your
          browser.
        </p>
      </div>
    );
  }

  if (phase === "done" && created) {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <ScreenHeader
          title="Sync created"
          subtitle={
            run
              ? `${formatNumber(run.rows)} rows written to “${created.sheetName}”.`
              : `Writing to “${created.sheetName}”.`
          }
        />
        <Card className="border-lime/50 bg-lime/10">
          <div className="text-[13px] font-semibold text-deep">{created.name}</div>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px] text-ink/60">
            <li>{created.sources.length} report(s), {created.columns.length} columns</li>
            {created.calculatedColumns.length > 0 ? (
              <li>{created.calculatedColumns.length} calculated column(s)</li>
            ) : null}
            <li>Refreshes {STEP_SCHEDULE_TEXT[created.schedule]}</li>
          </ul>
        </Card>
        <div className="flex flex-col gap-2">
          <Button onClick={() => ctx.navigate(route("sync-detail", { id: created.id }))}>
            Open this sync
          </Button>
          <Button variant="ghost" onClick={() => ctx.navigate("syncs")}>
            Back to syncs
          </Button>
        </div>
      </div>
    );
  }

  const stepProps: StepProps = {
    state,
    dispatch,
    reports,
    accounts,
    usage,
    sheetTabs,
    onConnectAccounts: () => ctx.navigate("connect-amazon"),
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={bodyRef} className="flex flex-col gap-3 pt-1">
        <ScreenHeader
          title={STEP_TITLE[state.step]}
          backLabel="Syncs"
          onBack={() => ctx.navigate("syncs")}
          subtitle={STEP_SUBTITLE[state.step]}
        />

        <StepDots
          index={index}
          canAdvance={blocker === null}
          onJump={(s) => dispatch({ type: "step", step: s })}
        />

        {templateId || proposalId ? (
          <Card className="border-forest/30 bg-forest/5 py-2.5">
            <div className="text-[12px] text-deep">
              Prefilled from {templateId ? "a template" : "the agent's proposal"} — change anything you like.
            </div>
          </Card>
        ) : null}

        <div className="pb-2">
          {state.step === "accounts" ? <StepAccounts {...stepProps} /> : null}
          {state.step === "reports" ? <StepReports {...stepProps} /> : null}
          {state.step === "columns" ? <StepColumns {...stepProps} /> : null}
          {state.step === "filters" ? <StepFilters {...stepProps} /> : null}
          {state.step === "destination" ? <StepDestination {...stepProps} /> : null}
          {state.step === "review" ? (
            <div className="flex flex-col gap-3">
              <StepReview {...stepProps} />
              {overLimit ? (
                <Card className="border-[#F59E0B]/40 bg-[#F59E0B]/10">
                  <div className="flex items-center gap-2">
                    <Badge tone="gray">Plan limit</Badge>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink/70">
                    The free plan covers {usage?.syncsLimit} syncs and you're using{" "}
                    {usage?.syncsUsed}. Pro lifts the cap and unlocks 15-minute
                    refresh. In mock mode this is a hint, not a wall.
                  </p>
                </Card>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="text-[12px] text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {/* sticky step footer */}
      <div className="sticky bottom-0 -mx-4 mt-auto border-t border-gray-100 bg-white/95 px-4 py-2.5 backdrop-blur">
        {blocker && !isLast ? (
          <p className="mb-1.5 text-[11.5px] text-ink/50">{blocker}</p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="px-3"
            onClick={() => (index === 0 ? ctx.navigate("syncs") : dispatch({ type: "back" }))}
          >
            {index === 0 ? "Cancel" : "Back"}
          </Button>
          <span className="ml-auto text-[11px] text-ink/40">
            Step {index + 1} of {WIZARD_STEPS.length}
          </span>
          {isLast ? (
            <Button onClick={() => void create()}>Create sync</Button>
          ) : (
            <Button disabled={blocker !== null} onClick={() => dispatch({ type: "next" })}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const STEP_SUBTITLE: Record<WizardStep, string> = {
  accounts: "Which Amazon accounts and marketplaces this sync reads from.",
  reports: "Pick one report, or several to blend into a single tab.",
  columns: "Only what you tick gets written — plus anything you calculate.",
  filters: "Narrow the rows before they ever reach the sheet.",
  destination: "Where it lands, and how often it refreshes itself.",
  review: "Last look before the first run.",
};

const STEP_SCHEDULE_TEXT: Record<string, string> = {
  "15min": "every 15 minutes",
  hourly: "hourly",
  daily: "daily",
  weekly: "weekly",
  manual: "only when you run it",
};

function StepDots({
  index,
  onJump,
  canAdvance,
}: {
  index: number;
  onJump: (step: WizardStep) => void;
  /** Whether the current step is complete — gates the one step ahead. */
  canAdvance: boolean;
}) {
  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Sync wizard steps">
      {WIZARD_STEPS.map((s, i) => {
        // Steps already visited are always reachable; the next one only once
        // the current step validates. Nothing further — the wizard is ordered.
        const reachable = i <= index || (i === index + 1 && canAdvance);
        return (
          <button
            key={s}
            role="tab"
            aria-selected={i === index}
            aria-label={`Step ${i + 1}: ${STEP_TITLE[s]}`}
            disabled={!reachable}
            onClick={() => onJump(s)}
            className={`h-1.5 flex-1 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-forest/30 ${
              i === index ? "bg-forest" : i < index ? "bg-forest/40" : "bg-ink/10"
            } ${reachable ? "cursor-pointer" : "cursor-not-allowed"}`}
          />
        );
      })}
    </div>
  );
}
