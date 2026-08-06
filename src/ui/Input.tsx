import { forwardRef, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Small helper line under the field. */
  hint?: string;
}

/** forwardRef so callers can drive the caret (the formula builder inserts
 * `[Field]` tokens at the cursor). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, id, className = "", ...rest },
  ref
) {
  const inputId = id ?? (label ? `in-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
  return (
    <label className="block text-left">
      {label ? (
        <span className="mb-1 block text-[12px] font-medium text-ink/60">{label}</span>
      ) : null}
      <input
        id={inputId}
        ref={ref}
        {...rest}
        className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-forest focus:ring-2 focus:ring-forest/20 ${className}`}
      />
      {hint ? <span className="mt-1 block text-[11px] leading-snug text-ink/40">{hint}</span> : null}
    </label>
  );
});
