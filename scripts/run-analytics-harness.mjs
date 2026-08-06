/**
 * Bundle + run test/analytics.harness.ts.
 *
 * esbuild (already present as a Vite dependency) compiles the harness and its
 * slice of src/ into one CommonJS file, which node then executes. No test
 * runner, no jsdom: the harness stubs `chrome.*` and `fetch` itself, and
 * src/analytics is deliberately free of DOM dependencies.
 *
 * `import.meta.env` is defined here because src/backend/index.ts reads
 * `import.meta.env.VITE_BACKEND` — outside Vite that expression is undefined
 * and dereferencing it would throw before a single assertion ran.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "ds-harness-"));
const outfile = join(outDir, "harness.cjs");

try {
  await build({
    entryPoints: [join(root, "test/analytics.harness.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile,
    define: { "import.meta.env": JSON.stringify({ VITE_BACKEND: "mock" }) },
    logLevel: "warning",
  });

  const res = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  process.exit(res.status ?? 1);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
