/**
 * Solution templates (route: templates, `dsp-category=<id>`) — the gallery
 * hopted puts one click from onboarding. "Use template" materialises the
 * template into a sync draft and drops the user into the wizard at the columns
 * step with everything already chosen.
 */
import { useEffect, useMemo, useState } from "react";
import { getBackend } from "../../backend";
import { TEMPLATE_CATEGORY_LABEL } from "../../backend/catalog";
import type { ReportCatalogEntry, Template, TemplateCategory } from "../../backend/types";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Spinner } from "../../ui/Spinner";
import { ScreenHeader } from "../../ui/Screen";
import type { AppContext } from "../App";
import { route } from "../router";

type Filter = "all" | TemplateCategory;

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "profitability", label: TEMPLATE_CATEGORY_LABEL.profitability },
  { id: "advertising", label: TEMPLATE_CATEGORY_LABEL.advertising },
  { id: "inventory", label: TEMPLATE_CATEGORY_LABEL.inventory },
  { id: "operations", label: TEMPLATE_CATEGORY_LABEL.operations },
];

function isFilter(v: string | undefined): v is Filter {
  return v !== undefined && FILTERS.some((f) => f.id === v);
}

export function Templates({ ctx, params }: { ctx: AppContext; params: Record<string, string> }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [reports, setReports] = useState<ReportCatalogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>(isFilter(params.category) ? params.category : "all");

  useEffect(() => {
    const backend = getBackend();
    void backend.listTemplates().then(setTemplates);
    void backend.listReports().then(setReports);
  }, []);

  const shown = useMemo(
    () => (templates ?? []).filter((t) => filter === "all" || t.category === filter),
    [templates, filter]
  );

  const pick = (next: Filter) => {
    setFilter(next);
    ctx.replace(route("templates", next === "all" ? {} : { category: next }));
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <ScreenHeader
        title="Templates"
        backLabel="Home"
        onBack={() => ctx.navigate("home")}
        subtitle="Sheets other Amazon sellers already asked for. Every one is a normal sync — edit it after."
      />

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.id} active={filter === f.id} onClick={() => pick(f.id)} className="shrink-0">
            {f.label}
          </Chip>
        ))}
      </div>

      {templates === null ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner size={20} />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((t) => (
            <Card key={t.id}>
              <Thumbnail category={t.category} />
              <div className="mt-2.5 text-[13.5px] font-semibold text-ink">{t.name}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink/60">{t.description}</p>
              <ul className="mt-2 flex flex-col gap-1">
                {t.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-ink/70">
                    <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[11px] leading-snug text-ink/40">
                Uses:{" "}
                {t.reportIds
                  .map((id) => reports.find((r) => r.id === id)?.name ?? id)
                  .join(" · ")}
              </div>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => ctx.navigate(route("sync-new", { template: t.id, step: "columns" }))}
                >
                  Use template
                </Button>
              </div>
            </Card>
          ))}
          {shown.length === 0 ? (
            <p className="text-center text-[12px] text-ink/40">Nothing in this category yet.</p>
          ) : null}
        </div>
      )}

      <p className="text-center text-[11px] leading-relaxed text-ink/40">
        Nothing here fits? Describe it to the{" "}
        <button
          className="font-medium text-forest underline underline-offset-2"
          onClick={() => ctx.navigate("agent")}
        >
          AI agent
        </button>{" "}
        instead.
      </p>
    </div>
  );
}

/**
 * Preview placeholder: a stylised sheet fragment, tinted per category. A real
 * screenshot goes here once the sync writer is live (Phase 8).
 */
function Thumbnail({ category }: { category: TemplateCategory }) {
  const tint: Record<TemplateCategory, string> = {
    profitability: "bg-forest",
    advertising: "bg-deep",
    inventory: "bg-lime",
    operations: "bg-[#F59E0B]",
  };
  return (
    <div
      className="overflow-hidden rounded-lg border border-gray-200 bg-white"
      aria-hidden="true"
      role="presentation"
    >
      <div className={`flex h-4 items-center gap-1 px-1.5 ${tint[category]}`}>
        {[10, 16, 12, 14].map((w, i) => (
          <span key={i} className="h-1 rounded-full bg-white/70" style={{ width: w }} />
        ))}
      </div>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex h-3.5 items-center gap-1 border-t border-gray-100 px-1.5">
          {[22, 14, 10, 18, 12].map((w, i) => (
            <span
              key={i}
              className="h-1 rounded-full bg-ink/10"
              style={{ width: w, opacity: 1 - row * 0.15 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
