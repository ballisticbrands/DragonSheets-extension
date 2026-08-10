import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  interactive?: boolean;
}

const BASE = "rounded-2xl border border-gray-200 bg-white p-4 text-left";

/**
 * An `interactive` Card renders a real <button>, not a clickable <div>.
 *
 * These cards are the primary navigation of the sidebar — the three
 * post-onboarding entry points and the Home nav rows. As <div onClick> they
 * were unreachable by keyboard and announced as nothing by a screen reader,
 * which a browser QA pass caught: the entry screen had only three focusable
 * elements and none of them were the cards the screen exists to offer.
 *
 * Non-interactive Cards stay <div> — several of them contain their own
 * buttons, and a <button> inside a <button> is invalid HTML.
 */
export function Card({ children, interactive = false, className = "", ...rest }: CardProps) {
  if (interactive) {
    return (
      <button
        type="button"
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
        className={`${BASE} w-full cursor-pointer transition-all hover:border-forest/30 hover:shadow-lg hover:shadow-forest/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 ${className}`}
      >
        {children}
      </button>
    );
  }
  return (
    <div {...rest} className={`${BASE} ${className}`}>
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
