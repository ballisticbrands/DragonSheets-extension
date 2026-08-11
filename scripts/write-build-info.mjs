#!/usr/bin/env node
/**
 * Records how dist/ was built, so tooling can tell mock from real without
 * guessing from bundle contents. (Grepping for `launchWebAuthFlow` does not
 * work: both modes bundle it — the choice is a runtime branch, not a
 * build-time exclusion.)
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const info = {
  backend: process.env.VITE_BACKEND === "real" ? "real" : "mock",
  authMode: process.env.VITE_AUTH_MODE ?? "(follows backend)",
};
writeFileSync(join(dist, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`build-info: backend=${info.backend} auth=${info.authMode}`);
