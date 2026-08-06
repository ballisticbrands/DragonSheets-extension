/**
 * The "DragonSheets" launcher pill injected into the Sheets toolbar area.
 *
 * Deliberately plain DOM with inline styles (no Tailwind, no React): it lives
 * inside Google's light DOM where our shadow-scoped styles can't reach, and
 * inline styles are immune to Google's global CSS.
 *
 * Placement mirrors hopted (§2.2): an anchor <div> inserted as the FIRST
 * child of #docs-toolbar. If the toolbar never appears we fall back to a
 * floating pill — never silently no-op (teardown hardening #1).
 */
import { sidebarStore } from "./sidebar-store";
import { logDiag } from "../lib/diagnostics";

const LAUNCHER_ID = "dragonsheets-launcher";

const PILL_STYLE = [
  "display:inline-flex",
  "align-items:center",
  "gap:6px",
  "background:#2F7D4F",
  "color:#fff",
  "border:none",
  "border-radius:14px",
  "padding:4px 12px",
  "margin:0 4px 0 8px",
  "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
  "font-size:12px",
  "font-weight:600",
  "letter-spacing:0.01em",
  "cursor:pointer",
  "line-height:18px",
  "vertical-align:middle",
].join(";");

function buildButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = LAUNCHER_ID;
  btn.type = "button";
  btn.setAttribute("aria-label", "Open DragonSheets");
  btn.setAttribute("style", PILL_STYLE);
  const dot = document.createElement("span");
  dot.setAttribute(
    "style",
    "width:6px;height:6px;border-radius:50%;background:#98CC65;display:inline-block"
  );
  btn.append(dot, document.createTextNode("DragonSheets"));
  btn.addEventListener("click", () => sidebarStore.toggle());
  btn.addEventListener("mouseenter", () => (btn.style.background = "#256B42"));
  btn.addEventListener("mouseleave", () => (btn.style.background = "#2F7D4F"));
  return btn;
}

export function injectLauncher(toolbar: Element | null): void {
  if (document.getElementById(LAUNCHER_ID)) return;
  const btn = buildButton();
  if (toolbar) {
    const anchor = document.createElement("div");
    anchor.id = "dragonsheets-launcher-anchor";
    anchor.setAttribute(
      "style",
      "display:inline-block;position:relative;vertical-align:middle"
    );
    anchor.appendChild(btn);
    toolbar.insertBefore(anchor, toolbar.firstChild);
  } else {
    // Toolbar anchor missed — float instead of disappearing.
    logDiag("launcher-fallback-floating");
    btn.style.position = "fixed";
    btn.style.right = "16px";
    btn.style.bottom = "16px";
    btn.style.zIndex = "2147483000";
    btn.style.boxShadow = "0 2px 10px rgba(15,61,46,0.35)";
    document.body.appendChild(btn);
  }
}
