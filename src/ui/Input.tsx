import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, id, className = "", ...rest }: InputProps) {
  const inputId = id ?? (label ? `in-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
  return (
    <label className="block text-left">
      {label ? (
        <span className="mb-1 block text-[12px] font-medium text-ink/60">{label}</span>
      ) : null}
      <input
        id={inputId}
        {...rest}
        className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-forest focus:ring-2 focus:ring-forest/20 ${className}`}
      />
    </label>
  );
}
