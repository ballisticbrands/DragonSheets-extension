import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
}

export function Card({ children, interactive = false, className = "", ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={`rounded-2xl border border-gray-200 bg-white p-4 text-left ${
        interactive
          ? "cursor-pointer transition-all hover:border-forest/30 hover:shadow-lg hover:shadow-forest/5"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "forest" }: { children: ReactNode; tone?: "forest" | "lime" | "gray" }) {
  const tones = {
    forest: "bg-forest/10 text-forest",
    lime: "bg-lime/20 text-deep",
    gray: "bg-ink/5 text-ink/50",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
