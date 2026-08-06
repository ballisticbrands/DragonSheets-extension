import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build tool decision (documented per spec): vanilla Vite multi-entry, NOT
 * @crxjs/vite-plugin. Reasons:
 *  - CRXJS v2 is in perpetual beta and has open compatibility issues with
 *    Vite 6; we don't want the first fleet extension pinned to an old Vite.
 *  - Our content script deliberately uses the loader-shim + dynamic-import
 *    pattern from the hopted teardown (a ~20-line plain-JS loader declared in
 *    the manifest that `import()`s the real ES module from
 *    web_accessible_resources). CRXJS generates its own loader and rewrites
 *    the manifest, which fights that explicit architecture.
 *  - The manifest is hand-authored in public/manifest.json and copied
 *    verbatim, so what ships is exactly what's reviewed.
 *
 * Entry map:
 *  - content-main   → assets/content-main.js  (dynamic-imported by content-loader.js)
 *  - service-worker → assets/service-worker.js (MV3 module service worker)
 *  - settings.html  → options page
 *  - mock-oauth.html→ mock Amazon-consent popup (web-accessible)
 *
 * Entry file names are fixed (no hash) because the manifest and the loader
 * reference them by path. Shared chunks keep hashes.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    modulePreload: false,
    rollupOptions: {
      input: {
        "content-main": "src/content/index.tsx",
        "service-worker": "src/background/service-worker.ts",
        settings: "settings.html",
        "mock-oauth": "mock-oauth.html",
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        // Keep node_modules (React) in a shared chunk so no entry doubles as
        // another entry's vendor bundle (otherwise Rollup makes settings.html
        // import from content-main.js).
        manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined),
      },
    },
  },
});
