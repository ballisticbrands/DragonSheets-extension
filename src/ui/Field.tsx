/**
 * Form primitives beyond Input: Select, Textarea, Checkbox, Radio.
 *
 * All of them are label-wrapped and carry the same focus ring as Input, so
 * keyboard users get a visible focus target everywhere in the sync wizard
 * (accessibility basics, and the sidebar is narrow enough that a missing focus
 * ring is genuinely disorienting).
 */
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const FOCUS =
  "outline-none transition-colors focus:border-forest focus:ring-2 focus:ring-forest/20";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  children: ReactNode;
}

export function Select({ label, className = "", children, ...rest }: SelectProps) {
  return (
    <label className="block text-left">
      {label ? <span className="mb-1 block text-[12px] font-medium text-ink/60">{label}</span> : null}
      <select
        {...rest}
        className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-ink ${FOCUS} ${className}`}
      >
        {children}
      </select>
    </label>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className = "", ...rest }: TextareaProps) {
  return (
    <label className="block text-left">
      {label ? <span className="mb-1 block text-[12px] font-medium text-ink/60">{label}</span> : null}
      <textarea
        {...rest}
        className={`w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-ink ${FOCUS} ${className}`}
      />
    </label>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: ReactNode;
  /** Renders the box in the "some children selected" state. */
  indeterminate?: boolean;
}

export function Checkbox({ label, hint, indeterminate, className = "", ...rest }: CheckboxProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-ink/[0.03] ${className}`}
    >
      <input
        type="checkbox"
        {...rest}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate) && !el.checked;
        }}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-forest focus:ring-2 focus:ring-forest/30"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] leading-snug text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-snug text-ink/40">{hint}</span> : null}
      </span>
    </label>
  );
}

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: ReactNode;
  /** Right-aligned slot — used for the plan-gating hint on schedule options. */
  trailing?: ReactNode;
}

export function Radio({ label, hint, trailing, className = "", ...rest }: RadioProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 px-3 py-2 transition-colors hover:border-forest/30 has-[:checked]:border-forest has-[:checked]:bg-forest/5 ${className}`}
    >
      <input
        type="radio"
        {...rest}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-forest focus:ring-2 focus:ring-forest/30"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium leading-snug text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-snug text-ink/50">{hint}</span> : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </label>
  );
}
