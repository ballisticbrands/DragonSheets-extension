/**
 * Bundle + run test/unit.harness.ts (the auth / real-backend harness).
 *
 * Same mechanism as scripts/run-analytics-harness.mjs: esbuild compiles the
 * harness and its slice of src/ into one CommonJS file, node executes it. No
 * test runner, no jsdom — the harness stubs `chrome.*` and `fetch` itself.
 *
 * Two node-side shims the browser gives us for free and node 18 does not
 * expose to a CJS bundle by name: `btoa`/`atob` are globals here, and
 * `crypto.getRandomValues` / `crypto.subtle` come from node:crypto's
 * webcrypto. Injected via `inject` so the source stays browser-shaped.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "ds-unit-"));
const outfile = join(outDir, "harness.cjs");
const shim = join(outDir, "shim.mjs");

// node has webcrypto under `crypto.webcrypto`; the extension code calls the
// bare `crypto.*` the browser exposes.
writeFileSync(
  shim,
  `import { webcrypto } from "node:crypto";
export const crypto = webcrypto;
`
);

try {
  await build({
    entryPoints: [join(root, "test/unit.harness.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile,
    inject: [shim],
    define: { "import.meta.env": JSON.stringify({ VITE_BACKEND: "mock" }) },
    logLevel: "warning",
  });

  const res = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  process.exit(res.status ?? 1);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
