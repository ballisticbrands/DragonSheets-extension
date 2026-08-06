/**
 * Sidebar mount: a fixed-position host <div> on document.body whose children
 * live inside a Shadow DOM root (teardown §9.2 avoid-#6 — hopted has no
 * shadow DOM and papers over `goog-*` CSS collisions with !important; we
 * isolate instead).
 *
 * Tailwind's compiled CSS is imported ?inline and attached as a constructed
 * stylesheet (adoptedStyleSheets), with a <style> tag fallback. Google's CSS
 * cannot reach in; ours cannot leak out.
 */
import { createRoot } from "react-dom/client";
import { SidebarApp } from "../app/App";
import { logDiag } from "../lib/diagnostics";
import type { SelectorMap } from "./selector-map";
import tailwindCss from "../app/styles.css?inline";

const HOST_ID = "dragonsheets-host";

export function mountSidebar(selectors: SelectorMap): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  // The host itself is a zero-footprint anchor; the panel inside the shadow
  // root positions itself fixed against the viewport.
  host.setAttribute("style", "position:fixed;top:0;right:0;width:0;height:0;z-index:2147483001;");
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(tailwindCss);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
  } catch (err) {
    // Older Chromium without constructable-stylesheet support in this path.
    logDiag("adopted-stylesheets-fallback", { error: String(err) });
    const style = document.createElement("style");
    style.textContent = tailwindCss;
    shadow.appendChild(style);
  }

  const container = document.createElement("div");
  container.id = "dragonsheets-app";
  shadow.appendChild(container);

  createRoot(container).render(<SidebarApp selectors={selectors} />);
}
