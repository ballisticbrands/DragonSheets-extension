/** Pill-shaped toggle used for filter chips and suggested agent prompts. */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export function Chip({ active = false, className = "", children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-forest/30 ${
        active
          ? "border-forest bg-forest text-white"
          : "border-gray-200 bg-white text-ink/60 hover:border-forest/30 hover:text-forest"
      } ${className}`}
    >
      {children}
    </button>
  );
}
