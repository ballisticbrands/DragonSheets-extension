/** Shared screen chrome: header with an optional back affordance, empty state,
 * usage meter and a horizontal tab strip. All sized for a 320–560px sidebar. */
import type { ReactNode } from "react";

export function ScreenHeader({
  title,
  subtitle,
  backLabel,
  onBack,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  backLabel?: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <div>
      {onBack ? (
        <button
          className="rounded text-[12px] text-ink/40 hover:text-ink focus:outline-none focus:ring-2 focus:ring-forest/30"
          onClick={onBack}
        >
          ‹ {backLabel ?? "Back"}
        </button>
      ) : null}
      <div className="mt-1 flex items-start justify-between gap-2">
        <h1 className="text-[18px] font-bold tracking-tight text-ink">{title}</h1>
        {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
      </div>
      {subtitle ? <p className="mt-1 text-[12.5px] leading-relaxed text-ink/60">{subtitle}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-[#fafafa] px-4 py-8 text-center">
      <div className="text-[13.5px] font-semibold text-ink">{title}</div>
      <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] leading-relaxed text-ink/50">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Meter({ value, max, tone = "forest" }: { value: number; max: number; tone?: "forest" | "amber" }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={`h-full rounded-full ${tone === "amber" ? "bg-[#F59E0B]" : "bg-forest"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-forest/30 ${
            active === t.id ? "bg-forest text-white" : "bg-ink/5 text-ink/60 hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
