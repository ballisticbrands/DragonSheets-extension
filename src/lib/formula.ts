/**
 * Calculated-column formula engine — a small, dependency-free tokenizer +
 * recursive-descent evaluator for `[Field Name]`-style expressions.
 *
 * Why hand-rolled: hopted ships a full expr-eval-style compiler client-side
 * and validates before ever calling the server (teardown §6.2). We copy the
 * *mechanism* — validate + preview locally, send only valid formulas — with a
 * much smaller grammar. `eval`/`new Function` are not an option anyway: MV3's
 * CSP forbids them.
 *
 * Grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := factor (('*' | '/') factor)*
 *   factor  := '-'? primary
 *   primary := number | '[' field ']' | NAME '(' args ')' | '(' expr ')'
 *
 * Functions: ROUND(x[, digits]), ABS(x), MIN(a, b, …), MAX(a, b, …).
 */

export interface FormulaField {
  /** Human field name as written inside the brackets. */
  name: string;
  /** Sample value used for the preview evaluation. */
  sample: string;
}

export interface FormulaCheck {
  ok: boolean;
  /** Human-readable first problem, when !ok. */
  error?: string;
  /** Tokens that don't match any available field. */
  unknownTokens: string[];
  /** Formatted preview from the sample values — undefined when not computable. */
  preview?: string;
}

const FUNCTIONS = new Set(["ROUND", "ABS", "MIN", "MAX"]);

/** Every `[Token]` in the formula, in order, duplicates included. */
export function extractTokens(formula: string): string[] {
  const out: string[] = [];
  const re = /\[([^\][]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) out.push((m[1] ?? "").trim());
  return out;
}

/** Turn "1,204.90" / "$24.99" / "12.8%" into a number; NaN when not numeric. */
export function parseSample(sample: string): number {
  const cleaned = sample.replace(/[,$%\s]/g, "");
  if (cleaned === "") return Number.NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Insert `[Field Name]` at a cursor position, returning the new value and the
 * cursor position after the inserted token.
 */
export function insertToken(
  value: string,
  cursor: number,
  fieldName: string
): { value: string; cursor: number } {
  const token = `[${fieldName}]`;
  const at = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, at);
  const after = value.slice(at);
  const needsSpace = before.length > 0 && !/[\s(+\-*/,]$/.test(before);
  const insert = (needsSpace ? " " : "") + token;
  return { value: before + insert + after, cursor: at + insert.length };
}

// ---------------------------------------------------------------------------
// tokenizer
// ---------------------------------------------------------------------------

type Tok =
  | { kind: "num"; value: number }
  | { kind: "field"; name: string }
  | { kind: "name"; name: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

class FormulaError extends Error {}

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "[") {
      const end = input.indexOf("]", i + 1);
      if (end === -1) throw new FormulaError("Unclosed [ — every field token needs a closing bracket.");
      toks.push({ kind: "field", name: input.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (ch === "]") throw new FormulaError("Stray ] with no matching [.");
    if (ch === "(") {
      toks.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      toks.push({ kind: "rparen" });
      i += 1;
      continue;
    }
    if (ch === ",") {
      toks.push({ kind: "comma" });
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      toks.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(input.slice(i));
      if (!m) throw new FormulaError(`Can't read the number near “${input.slice(i, i + 8)}”.`);
      toks.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i))!;
      toks.push({ kind: "name", name: m[0].toUpperCase() });
      i += m[0].length;
      continue;
    }
    throw new FormulaError(`“${ch}” isn't something a formula can use.`);
  }
  return toks;
}

// ---------------------------------------------------------------------------
// parser / evaluator
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(
    private readonly toks: Tok[],
    private readonly values: Map<string, number>,
    private readonly unknown: Set<string>
  ) {}

  parse(): number {
    const v = this.expr();
    if (this.pos < this.toks.length) throw new FormulaError("Unexpected extra input at the end.");
    return v;
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private expr(): number {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.value === "+" || t.value === "-")) {
        this.pos += 1;
        const right = this.term();
        left = t.value === "+" ? left + right : left - right;
      } else return left;
    }
  }

  private term(): number {
    let left = this.factor();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.value === "*" || t.value === "/")) {
        this.pos += 1;
        const right = this.factor();
        left = t.value === "*" ? left * right : right === 0 ? Number.NaN : left / right;
      } else return left;
    }
  }

  private factor(): number {
    const t = this.peek();
    if (t?.kind === "op" && t.value === "-") {
      this.pos += 1;
      return -this.factor();
    }
    if (t?.kind === "op" && t.value === "+") {
      this.pos += 1;
      return this.factor();
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.peek();
    if (!t) throw new FormulaError("The formula ends too early — something is missing.");
    if (t.kind === "num") {
      this.pos += 1;
      return t.value;
    }
    if (t.kind === "field") {
      this.pos += 1;
      if (t.name === "") throw new FormulaError("Empty [] — pick a field.");
      const v = this.values.get(t.name.toLowerCase());
      if (v === undefined) {
        this.unknown.add(t.name);
        return Number.NaN;
      }
      return v;
    }
    if (t.kind === "lparen") {
      this.pos += 1;
      const v = this.expr();
      if (this.peek()?.kind !== "rparen") throw new FormulaError("Missing a closing ).");
      this.pos += 1;
      return v;
    }
    if (t.kind === "name") {
      const fn = t.name;
      if (!FUNCTIONS.has(fn)) {
        throw new FormulaError(
          `“${fn}” isn't a function here. Available: ${[...FUNCTIONS].join(", ")}. Wrap field names in [brackets].`
        );
      }
      this.pos += 1;
      if (this.peek()?.kind !== "lparen") throw new FormulaError(`${fn} needs parentheses, e.g. ${fn}(…).`);
      this.pos += 1;
      const args: number[] = [];
      if (this.peek()?.kind !== "rparen") {
        args.push(this.expr());
        while (this.peek()?.kind === "comma") {
          this.pos += 1;
          args.push(this.expr());
        }
      }
      if (this.peek()?.kind !== "rparen") throw new FormulaError(`Missing a closing ) after ${fn}(.`);
      this.pos += 1;
      return applyFunction(fn, args);
    }
    throw new FormulaError("Two operators in a row — check the expression.");
  }
}

function applyFunction(fn: string, args: number[]): number {
  const a = args[0];
  switch (fn) {
    case "ABS":
      if (args.length !== 1 || a === undefined) throw new FormulaError("ABS takes exactly 1 value.");
      return Math.abs(a);
    case "ROUND": {
      if (args.length < 1 || args.length > 2 || a === undefined)
        throw new FormulaError("ROUND takes a value and optionally a number of digits.");
      const digits = args[1] ?? 0;
      const p = 10 ** Math.round(digits);
      return Math.round(a * p) / p;
    }
    case "MIN":
      if (args.length < 1) throw new FormulaError("MIN needs at least 1 value.");
      return Math.min(...args);
    case "MAX":
      if (args.length < 1) throw new FormulaError("MAX needs at least 1 value.");
      return Math.max(...args);
    default:
      throw new FormulaError(`Unknown function ${fn}.`);
  }
}

function formatPreview(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/**
 * Validate a formula against the available fields and, when it's valid,
 * evaluate it over their sample values for the live preview.
 */
export function validateFormula(formula: string, fields: FormulaField[]): FormulaCheck {
  const trimmed = formula.trim();
  if (trimmed === "") return { ok: false, error: "Enter a formula.", unknownTokens: [] };

  const values = new Map<string, number>();
  for (const f of fields) values.set(f.name.toLowerCase(), parseSample(f.sample));

  const unknown = new Set<string>();
  try {
    const result = new Parser(tokenize(trimmed), values, unknown).parse();
    if (unknown.size > 0) {
      const list = [...unknown];
      return {
        ok: false,
        error:
          list.length === 1
            ? `“${list[0]}” isn't one of the selected columns.`
            : `These aren't selected columns: ${list.map((t) => `“${t}”`).join(", ")}.`,
        unknownTokens: list,
      };
    }
    return {
      ok: true,
      unknownTokens: [],
      preview: Number.isFinite(result) ? formatPreview(result) : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof FormulaError ? err.message : "That formula can't be read.",
      unknownTokens: [...unknown],
    };
  }
}
