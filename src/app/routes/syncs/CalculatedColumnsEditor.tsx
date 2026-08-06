/**
 * Calculated-column editor — our take on hopted's property system
 * (teardown §6.2), reduced to the three kinds that earn their keep:
 * formula, constant and virtual (a reserved, never-overwritten column).
 *
 * Formulas are validated and previewed client-side on every keystroke
 * (src/lib/formula.ts); an unknown `[Token]` is an error before anything is
 * ever saved.
 */
import { useRef, useState } from "react";
import type { CalculatedColumn, CalculatedColumnKind } from "../../../backend/types";
import { insertToken, validateFormula, type FormulaField } from "../../../lib/formula";
import { Button } from "../../../ui/Button";
import { Input } from "../../../ui/Input";
import { Select } from "../../../ui/Field";

const KIND_HINT: Record<CalculatedColumnKind, string> = {
  formula: "Computed per row from the columns above.",
  constant: "The same literal value in every row.",
  virtual: "Reserved for you — the sync writes the header and never touches the cells.",
};

let seq = 0;
function newId(): string {
  seq += 1;
  return `cc_${Date.now().toString(36)}${seq}`;
}

export function CalculatedColumnsEditor({
  columns,
  fields,
  onAdd,
  onUpdate,
  onRemove,
}: {
  columns: CalculatedColumn[];
  fields: FormulaField[];
  onAdd: (column: CalculatedColumn) => void;
  onUpdate: (column: CalculatedColumn) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {columns.map((c) => (
        <CalculatedColumnCard
          key={c.id}
          column={c}
          fields={fields.filter((f) => f.name.toLowerCase() !== c.name.trim().toLowerCase())}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
      <Button
        variant="secondary"
        className="w-full"
        onClick={() =>
          onAdd({ id: newId(), name: "", kind: "formula", formula: "" })
        }
      >
        + Calculated column
      </Button>
      {columns.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-ink/40">
          Margin, ACOS, days of cover — anything you'd otherwise re-type into
          the sheet after every refresh.
        </p>
      ) : null}
    </div>
  );
}

function CalculatedColumnCard({
  column,
  fields,
  onUpdate,
  onRemove,
}: {
  column: CalculatedColumn;
  fields: FormulaField[];
  onUpdate: (column: CalculatedColumn) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cursorRef = useRef<number>((column.formula ?? "").length);
  const [showFields, setShowFields] = useState(false);

  const formula = column.formula ?? "";
  const check = column.kind === "formula" ? validateFormula(formula, fields) : null;

  const insert = (fieldName: string) => {
    const next = insertToken(formula, cursorRef.current, fieldName);
    onUpdate({ ...column, formula: next.value });
    cursorRef.current = next.cursor;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Input
            label="Column name"
            value={column.name}
            placeholder="Net margin %"
            onChange={(e) => onUpdate({ ...column, name: e.target.value })}
          />
        </div>
        <button
          className="mt-6 shrink-0 rounded-md px-2 py-1 text-[12px] text-ink/40 hover:bg-red-600/10 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-forest/30"
          onClick={() => onRemove(column.id)}
          aria-label={`Remove ${column.name || "calculated column"}`}
        >
          Remove
        </button>
      </div>

      <div className="mt-2">
        <Select
          label="Type"
          value={column.kind}
          onChange={(e) => onUpdate({ ...column, kind: e.target.value as CalculatedColumnKind })}
        >
          <option value="formula">Formula</option>
          <option value="constant">Constant</option>
          <option value="virtual">Virtual (yours to fill)</option>
        </Select>
        <p className="mt-1 text-[11px] leading-snug text-ink/40">{KIND_HINT[column.kind]}</p>
      </div>

      {column.kind === "formula" ? (
        <div className="mt-2">
          <Input
            ref={inputRef}
            label="Formula"
            value={formula}
            placeholder="[Spend] / [Sales 14d] * 100"
            spellCheck={false}
            aria-invalid={check ? !check.ok : undefined}
            className="font-mono text-[12px]"
            onChange={(e) => {
              cursorRef.current = e.target.selectionStart ?? e.target.value.length;
              onUpdate({ ...column, formula: e.target.value });
            }}
            onKeyUp={(e) => {
              cursorRef.current = e.currentTarget.selectionStart ?? formula.length;
            }}
            onClick={(e) => {
              cursorRef.current = e.currentTarget.selectionStart ?? formula.length;
            }}
          />

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <button
              className="rounded text-[11.5px] font-medium text-forest underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-forest/30"
              onClick={() => setShowFields((v) => !v)}
              aria-expanded={showFields}
            >
              {showFields ? "Hide fields" : "Insert a field"}
            </button>
            <span className="text-[11px] text-ink/40">+ − × ÷ ( ) ROUND ABS MIN MAX</span>
          </div>

          {showFields ? (
            <div className="mt-1.5 flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-lg bg-ink/[0.03] p-1.5">
              {fields.length === 0 ? (
                <span className="px-1 py-0.5 text-[11px] text-ink/40">
                  Select some columns first — they become the fields you can reference.
                </span>
              ) : (
                fields.map((f) => (
                  <button
                    key={f.name}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-ink/70 hover:border-forest/40 hover:text-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
                    onClick={() => insert(f.name)}
                    title={`Sample: ${f.sample}`}
                  >
                    {f.name}
                  </button>
                ))
              )}
            </div>
          ) : null}

          {check && formula.trim() !== "" ? (
            check.ok ? (
              <p className="mt-1.5 text-[11.5px] text-forest">
                Looks good{check.preview !== undefined ? ` — preview: ${check.preview}` : ""}
              </p>
            ) : (
              <p className="mt-1.5 text-[11.5px] text-red-600" role="alert">
                {check.error}
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {column.kind === "constant" ? (
        <div className="mt-2">
          <Input
            label="Value"
            value={column.constant ?? ""}
            placeholder="Ballistic Brands"
            onChange={(e) => onUpdate({ ...column, constant: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  );
}
