/**
 * Headless unit harness for the real-backend path (`npm run test:unit`).
 *
 * Same shape as test/analytics.harness.ts — no test runner, esbuild bundles it
 * and node runs it — because adding vitest + jsdom for three modules would
 * cost more than it returns. `chrome.*` and `fetch` are stubbed at the top.
 *
 * What it proves:
 *
 *   ✅ nonce generation is CSPRNG-backed, base64url, and unique per call
 *   ✅ nonce verification actually rejects a mismatched / missing / replayed
 *      nonce — the check that binds Google's answer to OUR request
 *   ✅ the ID token is parsed from the URL **fragment**, not the query string
 *   ✅ `aud`, `iss` and `exp` are all enforced client-side
 *   ✅ RealBackend attaches `Authorization: Bearer sc_live_…` to every call
 *      except POST /v1/auth/google, and to nothing anonymous
 *   ✅ a backend error sentence reaches the caller verbatim (the contract says
 *      it is written for a seller, so the UI must not paraphrase it)
 *   ✅ a 401 clears the stored token instead of looping on it
 *   ✅ /v1/connections maps to the extension's ConnectionStatus, including the
 *      "syncing ⇒ pending" rule that stops a half-done connect from firing a
 *      conversion
 *   ✅ every /v1/sheets/* method throws NotImplementedYet rather than faking
 *
 *   ❌ it does NOT talk to api.getdragonbot.com, and it does NOT run Google's
 *      consent screen. `fetch` and `chrome.identity` are stubs; whether Google
 *      honours the implicit id_token grant for this client is UNVERIFIED and
 *      cannot be verified from here (see src/auth/config.ts).
 */

declare const process: { exit(code: number): never };

// ─── chrome.* stub (installed before the imports) ─────────────────────────

const store = new Map<string, unknown>();

/** Requests the sidebar relayed to the "service worker". */
interface RelayedCall {
  method: string;
  path: string;
  body?: unknown;
  anonymous?: boolean;
}

/** Set by each test: how the stub SW should answer the next relay. */
let swHandler: (call: RelayedCall) => Promise<unknown> = async () => ({
  ok: false,
  status: 500,
  error: "no handler installed",
});

const chromeStub = {
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
    async sendMessage(message: unknown) {
      const m = message as { type?: string } & RelayedCall;
      if (m.type === "AUTH_SIGN_OUT") {
        store.delete("ds:auth-token");
        return { ok: true };
      }
      return swHandler(m);
    },
    lastError: undefined as { message: string } | undefined,
  },
};

(globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;

// ─── fetch stub ───────────────────────────────────────────────────────────

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let captured: CapturedRequest[] = [];

interface StubReply {
  status: number;
  body?: unknown;
  /** Raw body override, for the "backend answered with HTML" case. */
  raw?: string;
}

let nextReplies: StubReply[] = [];

function installFetchStub(): void {
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) => {
    captured.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const reply = nextReplies.shift() ?? { status: 200, body: {} };
    const text = reply.raw ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      async text() {
        return text;
      },
    };
  };
}
installFetchStub();

console.info = () => {};
console.warn = () => {};

// ─── imports (after the stubs) ────────────────────────────────────────────

import {
  base64UrlEncode,
  decodeIdToken,
  fragmentParams,
  idTokenFromFragment,
  mintNonce,
  oauthErrorFromResultUrl,
  queryParams,
  verifyIdToken,
} from "../src/auth/id-token";
import { apiFetch, readAuthToken, writeAuthToken } from "../src/backend/http";
import { NotImplementedYetError, RealBackend } from "../src/backend/real";
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

async function expectThrows(label: string, fn: () => Promise<unknown>, match: RegExp): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, match.test(msg), msg);
  }
}

function group(name: string): void {
  console.log(`\n${name}`);
}

function reset(): void {
  store.clear();
  captured = [];
  nextReplies = [];
  installFetchStub();
}

// ─── fixtures ─────────────────────────────────────────────────────────────

const CLIENT_ID = "776606808148-8p8l20pg1vt4jcbde2rr1orvlku87b55.apps.googleusercontent.com";

/** An unsigned JWT with the given claims. Signature verification is the
 * backend's job, so a fixed `sig` segment is exactly right here. */
function makeIdToken(claims: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(claims)}.c2ln`;
}

function validClaims(nonce: string, over: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1029384756",
    email: "seller@example.com",
    email_verified: true,
    name: "Jane Seller",
    picture: "https://lh3.googleusercontent.com/a/x",
    nonce,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...over,
  };
}

// ─── 1. nonce ─────────────────────────────────────────────────────────────

function testNonce(): void {
  group("1. nonce generation");

  const a = mintNonce();
  const b = mintNonce();
  check("base64url only — no +, / or = to break a URL", /^[A-Za-z0-9_-]+$/.test(a), a);
  check("32 bytes ⇒ 43 base64url characters", a.length === 43, String(a.length));
  check("two calls never collide", a !== b, `${a} vs ${b}`);

  const many = new Set(Array.from({ length: 500 }, () => mintNonce()));
  check("500 nonces are all distinct", many.size === 500, String(many.size));
}

// ─── 2. ID token: fragment parsing + verification ─────────────────────────

function testIdToken(): void {
  group("2. ID token — parsed from the FRAGMENT, then verified");

  const nonce = mintNonce();
  const token = makeIdToken(validClaims(nonce));
  const redirect = "https://papoimmliahhmamjdagmajeddimpmojo.chromiumapp.org/oauth2";

  check(
    "id_token is read out of the fragment",
    idTokenFromFragment(`${redirect}#id_token=${token}&authuser=0`) === token
  );
  check(
    "a token in the QUERY string is not mistaken for the answer",
    idTokenFromFragment(`${redirect}?id_token=${token}`) === null
  );
  check(
    "extra fragment params don't confuse the parse",
    idTokenFromFragment(`${redirect}#authuser=0&prompt=none&id_token=${token}`) === token
  );
  check(
    "a fragment-free redirect yields null, not a throw",
    idTokenFromFragment(redirect) === null
  );
  check(
    "fragment parsing stops at the fragment, query parsing at the fragment boundary",
    fragmentParams(`${redirect}?a=1#b=2`).get("b") === "2" &&
      queryParams(`${redirect}?a=1#b=2`).get("a") === "1" &&
      queryParams(`${redirect}?a=1#b=2`).get("b") === null
  );

  check(
    "Google's `error` in the fragment is surfaced, not reported as 'no token'",
    oauthErrorFromResultUrl(
      `${redirect}#error=unsupported_response_type&error_description=Wrong+type`
    ) === "unsupported_response_type: Wrong type"
  );
  check(
    "an `error` in the query string is caught too (the code-flow spelling)",
    oauthErrorFromResultUrl(`${redirect}?error=access_denied`) === "access_denied"
  );
  check("a clean redirect reports no error", oauthErrorFromResultUrl(`${redirect}#id_token=x`) === null);

  check(
    "claims decode",
    decodeIdToken(token)?.email === "seller@example.com",
    JSON.stringify(decodeIdToken(token))
  );
  check("a non-JWT decodes to null", decodeIdToken("not-a-jwt") === null);
  check("a JWT with a garbage payload decodes to null", decodeIdToken("a.!!!.c") === null);

  // --- the verification gate ---
  const ok = verifyIdToken({ idToken: token, expectedNonce: nonce, clientId: CLIENT_ID });
  check("a well-formed token for our nonce verifies", ok.ok === true, JSON.stringify(ok));

  const wrongNonce = verifyIdToken({
    idToken: token,
    expectedNonce: mintNonce(),
    clientId: CLIENT_ID,
  });
  check("a token minted for a DIFFERENT nonce is rejected", wrongNonce.ok === false);

  const noNonce = verifyIdToken({ idToken: token, expectedNonce: "", clientId: CLIENT_ID });
  check("a lost/absent stored nonce is rejected (replay guard)", noNonce.ok === false);

  const noClaimNonce = verifyIdToken({
    idToken: makeIdToken(validClaims(nonce, { nonce: undefined })),
    expectedNonce: nonce,
    clientId: CLIENT_ID,
  });
  check("a token with NO nonce claim is rejected", noClaimNonce.ok === false);

  const wrongAud = verifyIdToken({
    idToken: makeIdToken(validClaims(nonce, { aud: "someone-else.apps.googleusercontent.com" })),
    expectedNonce: nonce,
    clientId: CLIENT_ID,
  });
  check("a token issued for another client is rejected", wrongAud.ok === false);

  const wrongIss = verifyIdToken({
    idToken: makeIdToken(validClaims(nonce, { iss: "https://evil.example" })),
    expectedNonce: nonce,
    clientId: CLIENT_ID,
  });
  check("a token from an unexpected issuer is rejected", wrongIss.ok === false);

  check(
    "the bare `accounts.google.com` issuer spelling is accepted",
    verifyIdToken({
      idToken: makeIdToken(validClaims(nonce, { iss: "accounts.google.com" })),
      expectedNonce: nonce,
      clientId: CLIENT_ID,
    }).ok === true
  );

  const expired = verifyIdToken({
    idToken: makeIdToken(validClaims(nonce, { exp: Math.floor(Date.now() / 1000) - 3600 })),
    expectedNonce: nonce,
    clientId: CLIENT_ID,
  });
  check("an expired token is rejected", expired.ok === false);

  check(
    "a token expiring within the clock-skew window is still accepted",
    verifyIdToken({
      idToken: makeIdToken(validClaims(nonce, { exp: Math.floor(Date.now() / 1000) - 60 })),
      expectedNonce: nonce,
      clientId: CLIENT_ID,
    }).ok === true
  );

  const noEmail = verifyIdToken({
    idToken: makeIdToken(validClaims(nonce, { email: undefined })),
    expectedNonce: nonce,
    clientId: CLIENT_ID,
  });
  check("a token with no email is rejected", noEmail.ok === false);
}

// ─── 3. the SW HTTP layer: auth header + error handling ───────────────────

async function testApiFetch(): Promise<void> {
  group("3. service-worker HTTP layer — auth header, errors, token lifecycle");
  reset();

  const unauth = await apiFetch({ method: "GET", path: "/v1/connections" });
  check("a call with no stored token fails closed, without hitting the network",
    unauth.ok === false && unauth.status === 401 && captured.length === 0,
    JSON.stringify(unauth));
  check("…and names the reason machine-readably", unauth.errorCode === "not_signed_in");

  await writeAuthToken("sc_live_abcdef123456", 3600);
  const stored = await readAuthToken();
  check("the token round-trips through storage", stored?.token === "sc_live_abcdef123456");
  check(
    "expires_in becomes an absolute deadline",
    typeof stored?.expiresAt === "number" && stored!.expiresAt > Date.now(),
    String(stored?.expiresAt)
  );

  nextReplies = [{ status: 200, body: [{ id: "conn_1" }] }];
  const okRes = await apiFetch<Array<{ id: string }>>({ method: "GET", path: "/v1/connections" });
  check("a successful call returns the parsed body", okRes.ok && okRes.data?.[0]?.id === "conn_1");
  check(
    "it goes to the right base URL",
    captured[0]!.url === "https://api.getdragonbot.com/v1/connections",
    captured[0]!.url
  );
  check(
    "Authorization: Bearer <sc_ token> is attached",
    captured[0]!.headers.Authorization === "Bearer sc_live_abcdef123456",
    JSON.stringify(captured[0]!.headers)
  );

  // The one endpoint that must NOT carry a bearer.
  captured = [];
  nextReplies = [{ status: 200, body: { token: "sc_live_new", expires_in: 60 } }];
  await apiFetch({
    method: "POST",
    path: "/v1/auth/google",
    body: { credential: "eyJ…" },
    anonymous: true,
  });
  check(
    "an anonymous call carries NO Authorization header",
    captured[0]!.headers.Authorization === undefined,
    JSON.stringify(captured[0]!.headers)
  );
  check("…and does send JSON", captured[0]!.headers["Content-Type"] === "application/json");

  // Error sentence passthrough.
  captured = [];
  nextReplies = [
    { status: 400, body: { error: "Your Amazon account is already connected.", error_code: "duplicate_connection" } },
  ];
  const bad = await apiFetch({ method: "POST", path: "/v1/connect/amazon-ads/start" });
  check(
    "the backend's seller-facing sentence is surfaced VERBATIM",
    bad.error === "Your Amazon account is already connected.",
    String(bad.error)
  );
  check("…along with its error_code", bad.errorCode === "duplicate_connection");

  // Non-JSON error body (a proxy's HTML 502) must not throw.
  captured = [];
  nextReplies = [{ status: 502, raw: "<html>Bad Gateway</html>" }];
  const html = await apiFetch({ method: "GET", path: "/v1/connections" });
  check(
    "an HTML error page yields a sane sentence rather than a parse crash",
    html.ok === false && /HTTP 502/.test(html.error ?? ""),
    String(html.error)
  );

  // 401 drops the token so the UI can route back to sign-in.
  nextReplies = [{ status: 401, body: { error: "Not signed in." } }];
  await apiFetch({ method: "GET", path: "/v1/connections" });
  check(
    "a 401 clears the stored token instead of looping on it",
    (await readAuthToken()) === null && store.get(STORAGE_KEYS.authToken) === undefined
  );

  // An expired token is dropped before it can 401 everything.
  reset();
  await writeAuthToken("sc_live_old", 1);
  store.set(STORAGE_KEYS.authToken, { token: "sc_live_old", expiresAt: Date.now() - 1000 });
  check("a token past its deadline is discarded on read", (await readAuthToken()) === null);

  // Network failure.
  reset();
  await writeAuthToken("sc_live_x", 3600);
  (globalThis as unknown as { fetch: unknown }).fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const offline = await apiFetch({ method: "GET", path: "/v1/connections" });
  check(
    "a network drop becomes a friendly sentence, not an exception",
    offline.ok === false && offline.status === 0 && offline.errorCode === "network_error",
    JSON.stringify(offline)
  );
}

// ─── 4. RealBackend ───────────────────────────────────────────────────────

async function testRealBackend(): Promise<void> {
  group("4. RealBackend — mapping, error surfacing, and honest gaps");
  reset();

  const backend = new RealBackend();
  const calls: RelayedCall[] = [];

  /** Route the sidebar's relayed calls through the real SW HTTP layer. */
  swHandler = async (call) => {
    calls.push(call);
    return apiFetch({
      method: call.method as "GET",
      path: call.path,
      body: call.body,
      anonymous: call.anonymous,
    });
  };

  // --- signed out ---
  const none = await backend.getSession();
  check("no token ⇒ getSession() is null, not an error", none === null);

  await writeAuthToken("sc_live_session", 3600);

  // --- /v1/auth/me ---
  nextReplies = [
    { status: 200, body: { id: "usr_1", email: "seller@example.com", name: "Jane Seller", createdAt: "2026-08-01T00:00:00Z" } },
  ];
  const session = await backend.getSession();
  check(
    "getSession() maps /v1/auth/me onto Session",
    session?.userId === "usr_1" && session.email === "seller@example.com" && session.name === "Jane Seller",
    JSON.stringify(session)
  );
  check("it went through the SW relay, not a direct fetch", calls.some((c) => c.path === "/v1/auth/me"));

  // A user with no name falls back to the email rather than rendering "null".
  nextReplies = [
    { status: 200, body: { id: "usr_1", email: "seller@example.com", name: null, createdAt: "2026-08-01T00:00:00Z" } },
  ];
  check("a null name falls back to the email", (await backend.getSession())?.name === "seller@example.com");

  // --- connect start ---
  captured = [];
  nextReplies = [{ status: 200, body: { authorization_url: "https://sellercentral.amazon.com/apps/authorize/consent?x=1" } }];
  const start = await backend.startSpApiConnect();
  check(
    "startSpApiConnect() returns the consent URL",
    start.url === "https://sellercentral.amazon.com/apps/authorize/consent?x=1" &&
      start.provider === "amazon-selling-partner"
  );
  check(
    "it posts return_to as the brand's EXACT frontendBaseUrl (anything with a path is refused server-side)",
    (captured[0]!.body as { return_to: string }).return_to === "https://go.getdragonsheets.com",
    JSON.stringify(captured[0]!.body)
  );
  check("…to the SP-API start endpoint", captured[0]!.url.endsWith("/v1/connect/amazon-selling-partner/start"));

  captured = [];
  nextReplies = [{ status: 200, body: { authorization_url: "https://amazon.com/ap/oa?y=2" } }];
  await backend.startAdsConnect();
  check("startAdsConnect() hits the Ads start endpoint", captured[0]!.url.endsWith("/v1/connect/amazon-ads/start"));

  nextReplies = [{ status: 200, body: {} }];
  await expectThrows(
    "a start response with no authorization_url throws rather than opening about:blank",
    () => backend.startAdsConnect(),
    /consent link/i
  );

  nextReplies = [{ status: 503, body: { error: "Amazon Ads isn't set up on this server yet." } }];
  await expectThrows(
    "a backend error reaches the UI verbatim",
    () => backend.startAdsConnect(),
    /Amazon Ads isn't set up on this server yet\./
  );

  // --- /v1/connections mapping ---
  nextReplies = [
    {
      status: 200,
      body: [
        {
          id: "conn_sp", provider: "amazon-selling-partner", status: "connected",
          connected_at: "2026-08-09T12:00:00Z", error: null, name: "Ballistic Brands",
          seller_id: "A2VQ8KDL91NRT4", marketplace_ids: ["ATVPDKIKX0DER"], countries: ["US"],
          profile_ids: [], account_name: "Ballistic Brands (US)",
        },
        {
          id: "conn_ads", provider: "amazon-ads", status: "syncing",
          connected_at: "2026-08-10T09:00:00Z", error: null, name: null,
          seller_id: null, marketplace_ids: [], countries: [], profile_ids: ["3948571029"],
          account_name: null,
        },
      ],
    },
  ];
  const status = await backend.getConnectionStatus();
  check(
    "a connected SP-API row maps to state=connected with its account name",
    status.sellerCentral.state === "connected" &&
      status.sellerCentral.accountName === "Ballistic Brands (US)",
    JSON.stringify(status.sellerCentral)
  );
  check(
    "connected_at becomes an ms timestamp (the activation recency gate reads it)",
    status.sellerCentral.connectedAt === Date.parse("2026-08-09T12:00:00Z")
  );
  check(
    "`syncing` maps to PENDING, not connected — a half-done connect must not fire a conversion",
    status.ads.state === "pending",
    status.ads.state
  );

  nextReplies = [
    {
      status: 200,
      body: [
        { id: "conn_broken", provider: "amazon-selling-partner", status: "error", connected_at: "2026-08-01T00:00:00Z", error: "Amazon revoked access.", name: null, seller_id: null, marketplace_ids: [], countries: [], profile_ids: [], account_name: null },
        { id: "conn_good", provider: "amazon-selling-partner", status: "connected", connected_at: "2026-08-09T00:00:00Z", error: null, name: null, seller_id: "AAA", marketplace_ids: [], countries: [], profile_ids: [], account_name: "Good One" },
      ],
    },
  ];
  const twoRows = await backend.getConnectionStatus();
  check(
    "with two rows for one provider the healthiest wins (a failed retry can't hide a working account)",
    twoRows.sellerCentral.state === "connected" && twoRows.sellerCentral.accountName === "Good One",
    JSON.stringify(twoRows.sellerCentral)
  );

  // --- listAccounts ---
  nextReplies = [
    {
      status: 200,
      body: [
        { id: "conn_sp", provider: "amazon-selling-partner", status: "connected", connected_at: "2026-08-09T12:00:00Z", error: null, name: "BB", seller_id: "A2VQ", marketplace_ids: ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"], countries: ["US", "CA"], profile_ids: [], account_name: "Ballistic Brands (US)" },
        { id: "conn_pending", provider: "amazon-ads", status: "syncing", connected_at: "2026-08-10T09:00:00Z", error: null, name: null, seller_id: null, marketplace_ids: [], countries: [], profile_ids: [], account_name: null },
      ],
    },
  ];
  const accounts = await backend.listAccounts();
  check("only CONNECTED rows become accounts", accounts.length === 1 && accounts[0]!.id === "conn_sp", JSON.stringify(accounts));
  check(
    "marketplaces expand from marketplace_ids + countries",
    accounts[0]!.marketplaces.length === 2 &&
      accounts[0]!.marketplaces[0]!.countryCode === "US" &&
      accounts[0]!.marketplaces[1]!.id === "A2EUQ1WTGCTBG2",
    JSON.stringify(accounts[0]!.marketplaces)
  );
  check("the connection id is the account id — reconcileConnectionActivations dedupes on it",
    accounts[0]!.id === "conn_sp");

  // --- the honest gaps ---
  const gaps: Array<[string, () => Promise<unknown>]> = [
    ["listSyncs", () => backend.listSyncs()],
    ["createSync", () => backend.createSync({} as never)],
    ["runSync", () => backend.runSync("sync_1")],
    ["listReports", () => backend.listReports()],
    ["listTemplates", () => backend.listTemplates()],
    ["checkSheetAccess", () => backend.checkSheetAccess("1AbC")],
    ["getServiceAccountEmail", () => backend.getServiceAccountEmail()],
    ["sendAgentMessage", () => backend.sendAgentMessage("hi")],
    ["getUsage", () => backend.getUsage()],
  ];
  let allThrew = true;
  for (const [name, fn] of gaps) {
    try {
      await fn();
      allThrew = false;
      console.log(`        ${name} did NOT throw`);
    } catch (err) {
      if (!(err instanceof NotImplementedYetError)) {
        allThrew = false;
        console.log(`        ${name} threw the wrong type: ${String(err)}`);
      }
    }
  }
  check(
    "every not-yet-built endpoint throws NotImplementedYet instead of faking data",
    allThrew
  );

  // --- sign-out ---
  nextReplies = [{ status: 204 }];
  await backend.signOut();
  check("signOut() drops the stored bearer", store.get(STORAGE_KEYS.authToken) === undefined);
}

// ─── 5. the mock/real seam ────────────────────────────────────────────────

async function testSeam(): Promise<void> {
  group("5. the backend seam");
  reset();
  const { getBackend, getBackendMode } = await import("../src/backend/index");
  check(
    "VITE_BACKEND unset ⇒ mock (the demo/QA path is the default)",
    getBackendMode() === "mock"
  );
  check("getBackend() is a singleton", getBackend() === getBackend());
  check(
    "…and it is the MOCK client under the harness's env",
    getBackend().constructor.name === "MockBackend",
    getBackend().constructor.name
  );

  // ─── auth mode follows the backend ──────────────────────────────────────
  // Regression: on 2026-08-11 the first live sign-in failed with "signed in,
  // but the session didn't stick" because the build set VITE_BACKEND=real and
  // left VITE_AUTH_MODE unset. Mock auth then never ran the OAuth flow, so the
  // real backend was asked to read a session that was never created — and
  // nothing reached the server at all, which made it look like a network bug.
  const { resolveAuthMode } = await import("../src/auth/index");

  check(
    "unset + real backend ⇒ REAL auth (the bug: this used to be mock)",
    resolveAuthMode(undefined, "real") === "real",
    resolveAuthMode(undefined, "real")
  );
  check(
    "unset + mock backend ⇒ mock auth",
    resolveAuthMode(undefined, "mock") === "mock"
  );
  check(
    "explicit real overrides a mock backend",
    resolveAuthMode("real", "mock") === "real"
  );
  check(
    "explicit mock still forces mock against a real backend (escape hatch)",
    resolveAuthMode("mock", "real") === "mock"
  );
  check(
    "an unrecognised value falls back to following the backend",
    resolveAuthMode("yes-please", "real") === "real"
  );
}

// ─── run ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("DragonSheets unit harness (auth + real backend)\n==============================================");

  testNonce();
  testIdToken();
  await testApiFetch();
  await testRealBackend();
  await testSeam();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
}

void main();
