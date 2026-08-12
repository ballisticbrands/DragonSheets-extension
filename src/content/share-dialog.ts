/**
 * "Open it for me" — drive Google's own Share button on the user's behalf.
 *
 * ## Why the original didn't work
 *
 * It dispatched a synthetic `keydown`/`keypress` at the share button and
 * assumed that was enough. Against the real Sheets DOM it does nothing, for
 * two reasons:
 *
 *  1. `#docs-titlebar-share-client-button` is not a `<button>`. It is a
 *     Closure widget (`goog.ui.Button`) rendered as a `<div role="button">`,
 *     and Closure's control does not act on a bare `click` — `goog.ui.Control`
 *     wires `handleMouseDown` → `setActive(true)` and `handleMouseUp` →
 *     `performActionInternal()`. The *pair* is the activation, not the click.
 *  2. Closure's keyboard path runs through a `goog.events.KeyHandler` bound to
 *     the element **while it has focus**. Dispatching `keydown` at an
 *     unfocused node routes nowhere.
 *
 * ## What this does instead
 *
 * Escalates, cheapest first, and stops the moment a dialog is on screen:
 *
 *   1. `element.click()`            — native, wins on a real <button> or any
 *                                     plain click listener.
 *   2. pointer/mouse down-up pair   — the Closure path.
 *   3. focus + Enter, then Space    — the keyboard path, this time with focus.
 *
 * Staging matters: firing all three unconditionally would activate a Closure
 * widget twice and TOGGLE the dialog shut again.
 *
 * ## And when it still doesn't work
 *
 * It says so. `openShareDialog` reports `not-found` / `no-dialog` and the
 * share screen prints "click Share at the top right yourself". A control that
 * silently does nothing is the thing being fixed here; replacing it with a
 * control that silently does nothing *differently* would not be a fix.
 *
 * Note the detection is a heuristic — Google's dialog markup is not ours and
 * can change. It is used only to decide whether to escalate and whether to
 * show the fallback sentence, never to block the user.
 */
import { logDiag } from "../lib/diagnostics";

/** Markup that means "a modal is on screen". Google's Docs dialogs are
 * Closure dialogs (`.modal-dialog`); newer surfaces use ARIA. */
const DIALOG_SELECTORS = [
  "[role='dialog'][aria-modal='true']",
  ".modal-dialog",
  ".docs-sharedialog",
  ".shr-q-cb-dialog",
] as const;

/** How long to give Google's UI to put the dialog up between escalations. */
const SETTLE_MS = 300;

export type ShareDialogOutcome = "opened" | "no-dialog" | "not-found";

export interface ShareDialogResult {
  outcome: ShareDialogOutcome;
  /** Which escalation step produced a dialog — diagnostics only. */
  via?: "click" | "pointer" | "keyboard";
}

export function isDialogOpen(root: ParentNode = document): boolean {
  for (const selector of DIALOG_SELECTORS) {
    for (const el of root.querySelectorAll(selector)) {
      // A Closure dialog stays in the DOM between uses and is merely hidden.
      const style = el instanceof HTMLElement ? el.style : null;
      if (style && (style.display === "none" || style.visibility === "hidden")) continue;
      if (el instanceof HTMLElement && el.offsetParent === null && style?.position !== "fixed") {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * The node that actually carries the handler. Google sometimes wraps the
 * labelled span in the widget and sometimes the other way round, so accept
 * either direction — but only one hop, so we never wander off into the
 * toolbar.
 */
export function resolveActivationTarget(el: Element): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.matches("button, [role='button']")) return el;
  const inner = el.querySelector<HTMLElement>("button, [role='button']");
  if (inner) return inner;
  const outer = el.closest<HTMLElement>("button, [role='button']");
  return outer ?? el;
}

function mouseEvent(type: string): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
    detail: 1,
  });
}

function pointerEvent(type: string): Event {
  // PointerEvent is unavailable in a few embedded Chromiums; a MouseEvent with
  // the pointer type name is close enough for a listener that only cares that
  // the event fired.
  if (typeof PointerEvent === "function") {
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      isPrimary: true,
      pointerType: "mouse",
    });
  }
  return mouseEvent(type === "pointerdown" ? "mousedown" : "mouseup");
}

/** Step 2: the sequence a Closure control actually listens for. */
export function dispatchPointerActivation(el: HTMLElement): void {
  try {
    el.focus({ preventScroll: true });
  } catch {
    // Not focusable; the mouse path doesn't need it.
  }
  el.dispatchEvent(pointerEvent("pointerdown"));
  el.dispatchEvent(mouseEvent("mousedown"));
  el.dispatchEvent(pointerEvent("pointerup"));
  el.dispatchEvent(mouseEvent("mouseup"));
}

/** Step 3: keyboard activation — with focus this time, which is the point. */
export function dispatchKeyboardActivation(el: HTMLElement): void {
  try {
    el.focus({ preventScroll: true });
  } catch {
    return;
  }
  for (const key of ["Enter", " "] as const) {
    const code = key === "Enter" ? 13 : 32;
    for (const type of ["keydown", "keypress", "keyup"] as const) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code: key === "Enter" ? "Enter" : "Space",
          keyCode: code,
          which: code,
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    }
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Try to open Google's Share dialog. Never throws; the worst case is a
 * `no-dialog` result the caller turns into an instruction.
 */
export async function openShareDialog(selector: string): Promise<ShareDialogResult> {
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    el = null;
  }
  const target = el ? resolveActivationTarget(el) : null;
  if (!target) {
    logDiag("selector-miss", { key: "shareButton", selector, timeoutMs: 0 });
    return { outcome: "not-found" };
  }

  // Already open (the user beat us to it) — don't toggle it shut.
  if (isDialogOpen()) return { outcome: "opened" };

  const steps: Array<[ShareDialogResult["via"], () => void]> = [
    ["click", () => target.click()],
    ["pointer", () => dispatchPointerActivation(target)],
    ["keyboard", () => dispatchKeyboardActivation(target)],
  ];

  for (const [via, fire] of steps) {
    try {
      fire();
    } catch {
      continue;
    }
    await wait(SETTLE_MS);
    if (isDialogOpen()) {
      logDiag("share-dialog-opened", { via });
      return { outcome: "opened", via };
    }
  }

  logDiag("share-dialog-no-response", { selector });
  return { outcome: "no-dialog" };
}
