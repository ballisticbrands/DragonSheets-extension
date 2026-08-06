/** Onboarding step 3 — three entry paths (route: onboarding-completed).
 * Mirrors hopted's three-way fork with the AI path badged Recommended. */
import { Badge, Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import type { AppContext } from "../App";
import type { Route } from "../router";

const PATHS: Array<{
  route: Route;
  title: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    route: "agent",
    title: "Solve with AI",
    description: "Tell it the report you want — it picks the data and builds the sheet.",
    recommended: true,
  },
  {
    route: "templates",
    title: "Templates",
    description: "P&L by SKU, TACOS dashboard, restock planner — ready-made setups.",
  },
  {
    route: "syncs",
    title: "New Live Data Sync",
    description: "Pick a report and schedule yourself. Full control, no code.",
  },
];

export function OnboardingCompleted({ ctx }: { ctx: AppContext }) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-lime/25 text-[18px]">
          ✓
        </div>
        <h1 className="text-[18px] font-bold tracking-tight text-ink">
          DragonSheets is connected
        </h1>
        <p className="mt-1 text-[13px] text-ink/60">Pick how you want to start.</p>
      </div>

      <div className="flex flex-col gap-3">
        {PATHS.map((p) => (
          <Card key={p.route} interactive onClick={() => ctx.navigate(p.route)}>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-ink">{p.title}</span>
              {p.recommended ? <Badge tone="lime">Recommended</Badge> : null}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink/60">{p.description}</p>
          </Card>
        ))}
      </div>

      <Button variant="ghost" onClick={() => ctx.navigate("home")}>
        Skip for now → Home
      </Button>
    </div>
  );
}
