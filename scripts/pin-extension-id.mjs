#!/usr/bin/env node
/**
 * Pin the extension's ID by writing the Web Store item's public key into
 * public/manifest.json as `key`.
 *
 * WHY THIS EXISTS
 * An unpacked extension's ID is derived from its folder path, so a locally
 * loaded build gets a different ID from the published item. Everything keyed
 * to the ID then breaks in development only: the OAuth redirect URI
 * (`redirect_uri_mismatch` — this is what bit us on 2026-08-11), the
 * `externally_connectable` bridge, and the install-attribution handoff.
 *
 * With `key` present, Chrome derives the ID from that key instead of the path,
 * so dev and production match. The value is a PUBLIC key — safe to commit. The
 * Web Store ignores the field on upload.
 *
 * WHERE TO GET IT
 *   Web Store developer dashboard → the item → Package → "View public key".
 *   Copy the base64 between the BEGIN/END lines (newlines are fine).
 *
 * USAGE
 *   node scripts/pin-extension-id.mjs "<base64 public key>"
 *   node scripts/pin-extension-id.mjs --file key.pem
 *   node scripts/pin-extension-id.mjs --verify        # check current manifest
 *
 * It refuses to write a key that does not produce the expected ID, so a
 * mis-paste fails loudly here instead of as another redirect_uri_mismatch.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "public", "manifest.json");
const EXPECTED_ID = "papoimmliahhmamjdagmajeddimpmojo";

/** Chrome: first 16 bytes of SHA256(DER public key), each hex nibble 0-f → a-p. */
export function idFromKey(base64Key) {
  const der = Buffer.from(base64Key.replace(/\s+/g, ""), "base64");
  const hash = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

function stripPem(s) {
  return s
    .replace(/-----(BEGIN|END)[^-]*-----/g, "")
    .replace(/\s+/g, "");
}

const args = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

if (args[0] === "--verify" || args.length === 0) {
  if (!manifest.key) {
    console.error(
      `manifest has no "key" — the unpacked build will get a path-derived ID,\n` +
        `not ${EXPECTED_ID}, and Google will reject the OAuth redirect.\n\n` +
        `Fix: node scripts/pin-extension-id.mjs "<public key from the dashboard>"`,
    );
    process.exit(1);
  }
  const id = idFromKey(manifest.key);
  const ok = id === EXPECTED_ID;
  console.log(`${ok ? "OK" : "MISMATCH"}: manifest key ⇒ ${id}`);
  if (!ok) console.error(`expected ${EXPECTED_ID}`);
  process.exit(ok ? 0 : 1);
}

const raw = args[0] === "--file" ? readFileSync(args[1], "utf8") : args[0];
const key = stripPem(raw);
const id = idFromKey(key);

if (id !== EXPECTED_ID) {
  console.error(
    `That key produces extension ID:\n  ${id}\nbut the Web Store item is:\n  ${EXPECTED_ID}\n\n` +
      `Not writing it. Most likely the wrong key was copied — take it from\n` +
      `Package → "View public key" on THIS item.`,
  );
  process.exit(1);
}

manifest.key = key;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Pinned. manifest key ⇒ ${id}`);
console.log("Rebuild, then reload the extension at chrome://extensions.");
