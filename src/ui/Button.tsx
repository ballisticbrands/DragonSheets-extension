/**
 * Local Button/Input primitives styled per Dragon-marketing/BRANDING.md.
 *
 * NOTE: these deliberately mirror @ballisticbrands/frontend-shared's Button
 * API surface (variant prop, native button passthrough). The shared package
 * could not be installed in this repo (GH Packages E403 — see README
 * "frontend-shared" section); replace with the shared components once a
 * read:packages token exists, or fold these back into shared v0.5.x.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-forest text-white hover:bg-forest-dark shadow-sm disabled:bg-forest/40",
  secondary:
    "bg-forest/10 text-forest hover:bg-forest hover:text-white disabled:opacity-40",
  ghost:
    "bg-transparent text-ink/60 hover:bg-ink/5 hover:text-ink disabled:opacity-40",
  danger: "bg-red-600/10 text-red-700 hover:bg-red-600 hover:text-white",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold uppercase tracking-wide transition-all disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
