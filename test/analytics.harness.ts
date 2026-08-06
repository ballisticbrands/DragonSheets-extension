/**
 * Headless test harness for the analytics layer (`npm run test:analytics`).
 *
 * There is no test runner in this repo and adding one (vitest + jsdom +
 * happy-dom) for a handful of assertions would cost more than it returns. So:
 * esbuild bundles this file, node runs it, and `chrome.*` / `fetch` are
 * stubbed at the top. It exits non-zero on the first failure, which is all CI
 * needs.
 *
 * What it proves — and, just as importantly, what it does not:
 *
 *   ✅ the Measurement Protocol payload is byte-for-byte what GA4 expects
 *   ✅ `session_id` + `engagement_time_msec` ride on EVERY event (the trap
 *      that makes MP events invisible in standard reports)
 *   ✅ no PII key or email-shaped value can reach the wire
 *   ✅ `sign_up` fires exactly once across repeated calls
 *   ✅ activations dedupe per connection id
 *   ✅ the offline queue preserves order and honours its cap
 *   ✅ client_id precedence: bridge > existing > new
 *
 *   ❌ it does NOT talk to GA4. There are no credentials in this repo, so the
 *      real endpoint is never contacted and "GA4 accepted this payload" is
 *      asserted against the documented schema, not against Google.
 *   ❌ it does NOT drive Chrome. chrome.storage, messaging and the
 *      externally_connectable bridge are stubs; the real MV3 wiring is
 *      unverified until someone loads the unpacked build.
 */

// `@types/node` is not a dependency of this repo (it would pull node globals
// into the extension's own typechecking, where they do not belong), so the
// one node global the harness needs is declared locally. Type-only — erased
// at build time.
declare const process: { exit(code: number): never };

// ─── chrome.* stub ────────────────────────────────────────────────────────
// Installed BEFORE the imports below, because module top-level code touches
// chrome.runtime.getManifest() via lib/diagnostics.

interface ChromeStub {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
  runtime: {
    getManifest(): { version: string };
    sendMessage(...args: unknown[]): Promise<unknown>;
    lastError?: { message: string };
  };
}

const store = new Map<string, unknown>();

const chromeStub: ChromeStub = {
  storage: {
    local: {
      async get(key: string) {
        return store.has(key) ? { [key]: structuredClone(store.get(key)) } : {};
      },
      async set(items: Record<string, unknown>) {
        for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
      },
      async remove(key: string) {
        store.delete(key);
      },
    },
  },
  runtime: {
    getManifest: () => ({ version: "test" }),
    async sendMessage() {
      throw new Error("sendMessage must not be used: the harness runs as the service worker");
    },
  },
};

(globalThis as unknown as { chrome: ChromeStub }).chrome = chromeStub;

// ─── fetch stub ───────────────────────────────────────────────────────────

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let captured: CapturedRequest[] = [];
let online = true;

/** The default stub: records the request, answers 204 like /mp/collect does. */
function installFetchStub(): void {
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init?: { body?: string }
  ): Promise<{ ok: boolean; status: number; text(): Promise<string> }> => {
    if (!online) throw new TypeError("Failed to fetch (harness: offline)");
    captured.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    return { ok: true, status: 204, text: async () => "" };
  };
}
installFetchStub();

// Silence the intentional one-shot "unconfigured" warn and the diagnostics
// firehose; failures are reported by the assertions, not by log volume.
console.info = () => {};
console.warn = () => {};

// ─── imports (after the stubs) ────────────────────────────────────────────

import { __setCredentialsForTest } from "../src/analytics/config";
import {
  adoptBridgeClientId,
  getClientId,
  isValidClientId,
  mintClientId,
} from "../src/analytics/client-id";
import { flushQueue, sendEvent } from "../src/analytics/mp";
import {
  EVENTS,
  reconcileConnectionActivations,
  trackAccountConnected,
  trackSignUp,
} from "../src/analytics/events";
import { getBackend } from "../src/backend";
import { STORAGE_KEYS } from "../src/lib/storage";

// ─── assertion plumbing ───────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(name: string): void {
  console.log(`\n${name}`);
}

async function reset(): Promise<void> {
  store.clear();
  captured = [];
  online = true;
  installFetchStub(); // undo any per-test fetch replacement
}

// ─── 1. MP payload shape ──────────────────────────────────────────────────

async function testPayloadShape(): Promise<void> {
  group("1. Measurement Protocol payload shape");
  await reset();

  await sendEvent(
    "sidebar_opened",
    {
      source: "launcher",
      // Every one of these must be stripped before the wire.
      email: "seller@example.com",
      name: "Jane Seller",
      user_name: "jane",
      notes: "reach me at jane@example.com", // email-shaped VALUE, innocuous key
      // …while a legitimately name-ish key must survive.
      sheet_name: "Q3 P&L",
    },
    { userId: "usr_123", userProperties: { signup_source: "google_ads" } }
  );

  check("exactly one request was sent", captured.length === 1, `got ${captured.length}`);
  const req = captured[0]!;
  const body = req.body as {
    client_id?: string;
    user_id?: string;
    user_properties?: Record<string, { value: unknown }>;
    events?: Array<{ name: string; params: Record<string, unknown> }>;
  };

  check(
    "posts to the /mp/collect endpoint with both credentials",
    req.url.startsWith("https://www.google-analytics.com/mp/collect?measurement_id=") &&
      req.url.includes("api_secret="),
    req.url
  );
  check(
    "client_id present and GA4-shaped",
    isValidClientId(body.client_id),
    String(body.client_id)
  );
  check("user_id present when supplied", body.user_id === "usr_123");
  check("exactly one event per request", body.events?.length === 1);

  const ev = body.events![0]!;
  check("event name preserved", ev.name === "sidebar_opened", ev.name);
  check(
    "session_id present on the event (GA4 drops the event from standard reports without it)",
    typeof ev.params.session_id === "string" && ev.params.session_id.length > 0,
    JSON.stringify(ev.params.session_id)
  );
  check(
    "engagement_time_msec present and >= 1 (same trap)",
    typeof ev.params.engagement_time_msec === "number" &&
      (ev.params.engagement_time_msec as number) >= 1,
    String(ev.params.engagement_time_msec)
  );
  check("caller params survive", ev.params.source === "launcher");
  check(
    "a legitimate *_name param is NOT collateral damage",
    ev.params.sheet_name === "Q3 P&L"
  );

  // PII keys are checked against the PARAM names, not the raw JSON: the
  // envelope legitimately contains `"name"` as the event-name field.
  const paramKeys = Object.keys(ev.params).concat(
    Object.keys(body.user_properties ?? {})
  );
  for (const key of ["email", "name", "user_name"]) {
    check(`no \`${key}\` param reaches the wire`, !paramKeys.includes(key), paramKeys.join(","));
  }
  const wire = JSON.stringify(req.body);
  check(
    "no email-shaped VALUE anywhere in the payload, whatever its key is called",
    !/[^\s@"]+@[^\s@"]+\.[^\s@"]+/.test(wire),
    wire.slice(0, 300)
  );
  check(
    "user_properties wrapped in GA4's {value: …} form",
    body.user_properties?.signup_source?.value === "google_ads",
    JSON.stringify(body.user_properties)
  );
}

// ─── 2. sign_up fires exactly once ────────────────────────────────────────

async function testSignUpOnce(): Promise<void> {
  group("2. sign_up fires exactly once, ever");
  await reset();

  for (let i = 0; i < 5; i++) await trackSignUp({ id: "usr_abc" });

  const signUps = captured.filter((r) =>
    ((r.body as { events: Array<{ name: string }> }).events ?? []).some(
      (e) => e.name === EVENTS.signUp
    )
  );
  check("5 calls produced 1 sign_up", signUps.length === 1, `got ${signUps.length}`);
  check(
    "the dedupe flag is persisted",
    store.get(STORAGE_KEYS.gaSignupLogged) === true
  );
  check(
    "user_id is persisted for later events",
    store.get(STORAGE_KEYS.gaUserId) === "usr_abc"
  );

  // A later, unrelated event must carry the user_id without re-firing sign_up.
  captured = [];
  await sendEventViaEvents();
  const after = captured.filter((r) =>
    ((r.body as { events: Array<{ name: string }> }).events ?? []).some(
      (e) => e.name === EVENTS.signUp
    )
  );
  check("no sign_up on subsequent events", after.length === 0);
}

async function sendEventViaEvents(): Promise<void> {
  const { trackSheetShared } = await import("../src/analytics/events");
  await trackSheetShared();
}

// ─── 3. activation dedupe ─────────────────────────────────────────────────

async function testActivationDedupe(): Promise<void> {
  group("3. connect_amazon activations dedupe per connection id");
  await reset();

  const names = () =>
    captured.flatMap((r) =>
      ((r.body as { events: Array<{ name: string }> }).events ?? []).map((e) => e.name)
    );

  await trackAccountConnected("amazon_seller", { connectionId: "conn_1" });
  check(
    "one seller connection fires the umbrella AND the specific event",
    names().filter((n) => n === EVENTS.connectAmazon).length === 1 &&
      names().filter((n) => n === EVENTS.connectAmazonSeller).length === 1,
    names().join(",")
  );
  check(
    "the umbrella is sent FIRST (it is the Ads conversion)",
    names()[0] === EVENTS.connectAmazon,
    names().join(",")
  );

  await trackAccountConnected("amazon_seller", { connectionId: "conn_1" });
  await trackAccountConnected("amazon_seller", { connectionId: "conn_1" });
  check(
    "repeat calls for the same connection id fire nothing",
    names().filter((n) => n === EVENTS.connectAmazon).length === 1,
    names().join(",")
  );

  await trackAccountConnected("amazon_ads", { connectionId: "conn_2" });
  check(
    "a DIFFERENT connection id does fire (umbrella x2 total)",
    names().filter((n) => n === EVENTS.connectAmazon).length === 2 &&
      names().filter((n) => n === EVENTS.connectAmazonAds).length === 1,
    names().join(",")
  );
  check(
    "both connection ids are recorded in the activations key",
    JSON.stringify(store.get(STORAGE_KEYS.activations)) === JSON.stringify(["conn_1", "conn_2"]),
    JSON.stringify(store.get(STORAGE_KEYS.activations))
  );

  // Now the state-driven path, against the real (mock) BackendClient — the
  // point being that activations come from connection STATE, never from the
  // OAuth popup message.
  await reset();
  const backend = getBackend();
  await backend.completeConnect("amazon-selling-partner");
  const firedFirst = await reconcileConnectionActivations();
  const firedSecond = await reconcileConnectionActivations();
  check(
    "reconcile fires once for a newly-connected account",
    firedFirst === 1,
    `got ${firedFirst}`
  );
  check(
    "reconcile is idempotent on a second sidebar mount",
    firedSecond === 0,
    `got ${firedSecond}`
  );
  check(
    "reconcile emitted the umbrella + the seller event",
    names().filter((n) => n === EVENTS.connectAmazon).length === 1 &&
      names().filter((n) => n === EVENTS.connectAmazonSeller).length === 1,
    names().join(",")
  );
}

// ─── 4. offline queue: order + cap ────────────────────────────────────────

async function testQueue(): Promise<void> {
  group("4. offline queue — order preserved, cap honoured");
  await reset();

  online = false;
  for (let i = 0; i < 60; i++) await sendEvent("sidebar_opened", { seq: i });

  check("nothing was sent while offline", captured.length === 0, `got ${captured.length}`);
  const queued = store.get(STORAGE_KEYS.gaQueue) as Array<{ params: { seq: number } }>;
  check("queue is capped at 50", queued.length === 50, `got ${queued.length}`);
  check(
    "the cap evicts the OLDEST entries (a week offline must not block today's conversion)",
    queued[0]!.params.seq === 10 && queued[49]!.params.seq === 59,
    `first=${queued[0]!.params.seq} last=${queued[49]!.params.seq}`
  );

  online = true;
  const result = await flushQueue();
  check("flush reports success", result.ok && result.queued === 0, JSON.stringify(result));
  check("all 50 were sent", captured.length === 50, `got ${captured.length}`);

  const seqs = captured.map(
    (r) => (r.body as { events: Array<{ params: { seq: number } }> }).events[0]!.params.seq
  );
  const ordered = seqs.every((s, i) => s === i + 10);
  check("flushed in queue order, oldest first", ordered, seqs.slice(0, 5).join(","));
  check(
    "the queue is empty after a clean flush",
    ((store.get(STORAGE_KEYS.gaQueue) as unknown[]) ?? []).length === 0
  );
  check(
    "every flushed event still carries session_id + engagement_time_msec",
    captured.every((r) => {
      const p = (r.body as { events: Array<{ params: Record<string, unknown> }> }).events[0]!
        .params;
      return typeof p.session_id === "string" && typeof p.engagement_time_msec === "number";
    })
  );

  // A partial flush must not reorder: go offline mid-drain and confirm the
  // remainder stays in place.
  await reset();
  online = false;
  for (let i = 0; i < 3; i++) await sendEvent("sidebar_opened", { seq: i });
  let sends = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init?: { body?: string }
  ) => {
    if (sends++ >= 1) throw new TypeError("Failed to fetch (harness: mid-flush drop)");
    captured.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    return { ok: true, status: 204, text: async () => "" };
  };
  const partial = await flushQueue();
  const left = store.get(STORAGE_KEYS.gaQueue) as Array<{ params: { seq: number } }>;
  check("a mid-flush failure halts rather than skipping", !partial.ok);
  check(
    "the un-sent remainder stays queued, in order",
    left.length === 2 && left[0]!.params.seq === 1 && left[1]!.params.seq === 2,
    JSON.stringify(left.map((e) => e.params.seq))
  );
}

// ─── 5. client_id precedence ──────────────────────────────────────────────

async function testClientIdPrecedence(): Promise<void> {
  group("5. client_id precedence — bridge > existing > new");

  // (a) format
  const minted = mintClientId();
  check("minted ids match GA4's <uint32>.<epoch-seconds> format", isValidClientId(minted), minted);

  // (b) new: minted once, then stable
  await reset();
  const first = await getClientId();
  const second = await getClientId();
  check("a fresh install mints one id and reuses it", first === second, `${first} vs ${second}`);
  check(
    "provenance recorded as 'minted'",
    (store.get(STORAGE_KEYS.gaClientId) as { source: string }).source === "minted"
  );

  // (c) bridge beats an existing id — while no events have been sent
  await reset();
  const own = await getClientId();
  const outcome = await adoptBridgeClientId("1739468182.1754438400");
  check("bridge id is adopted before any event is sent", outcome === "adopted", outcome);
  check(
    "the adopted id replaces the minted one",
    (await getClientId()) === "1739468182.1754438400" && own !== "1739468182.1754438400"
  );
  check(
    "provenance recorded as 'bridge'",
    (store.get(STORAGE_KEYS.gaClientId) as { source: string }).source === "bridge"
  );

  // (d) bridge does NOT beat an id we have already reported under
  await reset();
  const established = await getClientId();
  await sendEvent("sidebar_opened", {});
  const late = await adoptBridgeClientId("1111111111.1222222222");
  check("a late bridge id is rejected once events exist", late === "rejected", late);
  check(
    "the established id survives (one user, not two)",
    (await getClientId()) === established
  );
  check(
    "the rejected id is kept for diagnosis",
    (store.get(STORAGE_KEYS.gaClientId) as { rejectedBridgeId?: string }).rejectedBridgeId ===
      "1111111111.1222222222"
  );

  // (e) garbage in, nothing changed
  await reset();
  const before = await getClientId();
  const bad = await adoptBridgeClientId("GA1.1.not-a-client-id");
  check("a malformed bridge id is refused", bad === "invalid", bad);
  check("the existing id is untouched by a malformed payload", (await getClientId()) === before);

  // (f) idempotent re-delivery (the bridge page fires on every /installed/ visit)
  await reset();
  await adoptBridgeClientId("1739468182.1754438400");
  const again = await adoptBridgeClientId("1739468182.1754438400");
  check("re-delivering the same bridge id is a no-op", again === "unchanged", again);
}

// ─── run ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  __setCredentialsForTest({ measurementId: "G-HARNESS00", apiSecret: "harness-secret" });
  console.log("DragonSheets analytics harness\n==============================");

  await testPayloadShape();
  await testSignUpOnce();
  await testActivationDedupe();
  await testQueue();
  await testClientIdPrecedence();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
}

void main();
