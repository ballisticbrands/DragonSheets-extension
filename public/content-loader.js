// DragonSheets content-script loader shim.
//
// This is the only file declared in manifest content_scripts. It stays tiny on
// purpose (hopted-teardown §2.1 pattern): the real app is an ES module in
// web_accessible_resources, dynamic-imported here, which gives the content
// script native ESM code-splitting and lazy import() — impossible for a
// manifest-declared classic content script.
//
// Keep this file dependency-free plain JS; it is copied verbatim to dist/.
(async () => {
  try {
    // Same isolated world as the imported module — hand over the inject
    // timestamp via a realm global (the module self-executes on import;
    // Vite app builds don't preserve entry exports).
    window.__dragonsheetsInjectedAt = Date.now();
    const src = chrome.runtime.getURL("assets/content-main.js");
    await import(src);
  } catch (err) {
    // Single structured diagnostic line — greppable, machine-parseable.
    console.info(
      "[dragonsheets] " +
        JSON.stringify({
          event: "loader-failed",
          error: String(err && err.message ? err.message : err),
          href: location.pathname,
        })
    );
  }
})();
