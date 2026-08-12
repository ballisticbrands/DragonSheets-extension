/**
 * Where the sidebar's top edge goes.
 *
 * The panel used to be `top:0; height:100vh`, which laid it straight over
 * Google's title bar and toolbar — including the **Share** button, which is
 * the one control the onboarding screen tells the user to click. The panel was
 * covering the thing it was asking for.
 *
 * So the offset is measured, not hardcoded: the bottom of Google's own chrome,
 * taken from the selectors we already own (`SelectorMap`), recomputed whenever
 * it can move. Hardcoding would break the moment Google adds a row, and break
 * silently — the failure mode is a covered button, which nobody reports as a
 * bug, they just give up.
 *
 * Both bars are measured and the LOWER edge wins, because their nesting is not
 * stable: in the live DOM `#docs-toolbar` sits inside `#docs-bars`, and taking
 * `#docs-bars` alone is right; in a DOM where they are siblings, taking
 * `#docs-bars` alone would leave the panel over the toolbar — where our own
 * launcher pill lives. `Math.max` is correct in both.
 */
import { logDiag } from "../lib/diagnostics";
import { waitFor, type SelectorMap } from "./selector-map";

/** The CSS custom property the panel reads. Set on the shadow host, which
 * inherits into the shadow tree. */
export const TOP_OFFSET_VAR = "--ds-top-offset";

/** Used only when NO bar can be found at all — roughly Sheets' title row. */
export const FALLBACK_TOP_OFFSET = 56;

/** A measurement past this is a broken DOM, not a tall toolbar. Clamping stops
 * one bad rect from eating the whole panel. */
export const MAX_TOP_OFFSET = 240;

export function clampTopOffset(value: number, fallback = FALLBACK_TOP_OFFSET): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(MAX_TOP_OFFSET, Math.round(value)));
}

/**
 * The bottom edge of Google's chrome, in CSS pixels from the top of the
 * viewport. A found-but-zero-height bar means Sheets is in full-screen mode
 * and 0 is the right answer — which is why "found" and "missing" are
 * distinguished rather than both falling back to 56.
 */
export function measureTopOffset(selectors: SelectorMap, doc: Document = document): number {
  let found = false;
  let bottom = 0;
  for (const selector of [selectors.docsBars, selectors.docsToolbar]) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(selector);
    } catch {
      el = null;
    }
    if (!el) continue;
    found = true;
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  }
  return found ? clampTopOffset(bottom, 0) : FALLBACK_TOP_OFFSET;
}

/**
 * Keep `--ds-top-offset` on `host` in step with the page. Returns a teardown.
 *
 * Recomputed on resize and, where available, whenever either bar's own box
 * changes — Sheets grows a second toolbar row for a chart selection, and the
 * panel has to follow it down rather than sit under it.
 */
export function installTopOffset(host: HTMLElement, selectors: SelectorMap): () => void {
  let last = -1;
  const apply = (): void => {
    const next = measureTopOffset(selectors);
    if (next === last) return;
    last = next;
    host.style.setProperty(TOP_OFFSET_VAR, `${next}px`);
  };
  apply();
  logDiag("top-offset-installed", { offset: last });

  window.addEventListener("resize", apply, { passive: true });

  const observers: ResizeObserver[] = [];
  const observe = (el: Element): void => {
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    observers.push(ro);
  };

  for (const selector of [selectors.docsBars, selectors.docsToolbar]) {
    const el = document.querySelector(selector);
    if (el) {
      observe(el);
      continue;
    }
    // Google's chrome can render after we mount. Pick it up when it lands
    // rather than living with the fallback for the rest of the session.
    void waitFor(selector, 30_000).then((late) => {
      if (!late) return;
      apply();
      observe(late);
    });
  }

  return () => {
    window.removeEventListener("resize", apply);
    for (const ro of observers) ro.disconnect();
  };
}
