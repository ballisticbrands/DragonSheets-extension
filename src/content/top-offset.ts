/**
 * Where the sidebar's top edge goes.
 *
 * The panel used to be `top:0; height:100vh`, which laid it straight over
 * Google's title bar — including the **Share** button, the one control the
 * onboarding screen tells the user to click. The panel covered the thing it
 * was asking for.
 *
 * ── Why a constant rather than a measurement ──────────────────────────────
 * This measured the bottom of Google's chrome via `SelectorMap`. That is more
 * precise, and more things can go wrong with it: it depends on Google's DOM
 * (ids, nesting, render timing) and needs a resize listener and a
 * `ResizeObserver` per bar to stay honest.
 *
 * A fixed offset is deliberately dumber and does not care what Google does to
 * its markup. The trade is real but favourable: when a constant is wrong it is
 * wrong *visibly and slightly* — a thin gap, or a few pixels of overlap —
 * whereas a selector that stops matching fails at whatever the fallback
 * happens to be, and a covered Share button is not something users report,
 * they just give up.
 *
 * If Sheets ever changes its chrome height, edit the one number below.
 */

/** The CSS custom property the panel reads. Set on the shadow host, which
 * inherits into the shadow tree. */
export const TOP_OFFSET_VAR = "--ds-top-offset";

/**
 * Distance from the top of the viewport to the sidebar's top edge, in CSS
 * pixels. Sized to clear the Sheets title row (document name, star, Share)
 * and the menu bar beneath it.
 */
export const TOP_OFFSET = 100;

/**
 * Publish the offset on `host`. Returns a teardown for symmetry with the rest
 * of the mount code — there is nothing to tear down now, and callers should
 * not have to know that.
 */
export function installTopOffset(host: HTMLElement): () => void {
  host.style.setProperty(TOP_OFFSET_VAR, `${TOP_OFFSET}px`);
  return () => {
    host.style.removeProperty(TOP_OFFSET_VAR);
  };
}
