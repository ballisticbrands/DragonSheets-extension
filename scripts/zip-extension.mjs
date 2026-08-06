// Zips dist/ into release/dragonsheets-extension-v<version>.zip — the artifact
// CI uploads and (later) the file uploaded to the Chrome Web Store.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "manifest.json"))) {
  console.error("dist/manifest.json not found — run `npm run build` first.");
  process.exit(1);
}
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const releaseDir = join(root, "release");
mkdirSync(releaseDir, { recursive: true });
const out = join(releaseDir, `dragonsheets-extension-v${version}.zip`);
rmSync(out, { force: true });
execSync(`zip -qr ${JSON.stringify(out)} .`, { cwd: dist, stdio: "inherit" });
console.log(`wrote ${out}`);
