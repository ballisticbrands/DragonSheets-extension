# Analytics & funnel tracking

How DragonSheets measures its funnel, why an extension has to do it
differently from every other product in the fleet, and how to verify it is
actually working.

Implements `sellerconnect/DRAGONSHEETS_PLAN.md` **Phase 5**. Event-name
doctrine comes from `Dragon-marketing/skills/new-product-funnel/SKILL.md`
Phase 6; conversion wiring from `skills/google-ads-setup/SKILL.md` §5.

---

## 1. Why this product is different

Every other Dragon product is a website. It loads `gtag.js`, `clarity.ms` and
`fbevents.js`, and `frontend-shared/src/attribution.ts` fires events through
those three globals.

**An MV3 extension cannot do any of that.** Manifest V3 forbids remote code:
`https://www.googletagmanager.com/gtag/js` is remote code, so it can neither
be loaded in an extension page nor injected from the service worker. Chrome
Web Store review rejects it, and the `extension_pages` CSP blocks it at
runtime even if review missed it. The same applies to Clarity and the Meta
pixel.

So the surfaces split:

| Surface | Stack | Sends |
|---|---|---|
| `getdragonsheets.com` (landing page, separate repo) | gtag + Clarity + Meta | `page_view`, `cta_click`, `pricing_view` |
| `go.getdragonsheets.com` (`site/`, this repo) | gtag + Clarity + Meta | `page_view`, and `extension_installed` on `/installed/` |
| **The extension** (sidebar + service worker) | **GA4 Measurement Protocol** | `sidebar_opened`, `sign_up`, `sheet_shared`, `connect_amazon`(+ specifics), `sync_created`, `agent_prompt_sent` |

All of it lands in **one GA4 property**. Clarity and Meta see the web
surfaces only — in-extension behaviour is invisible to them by construction,
which is why `extension_installed` is fired from the web page rather than
from `chrome.runtime.onInstalled`: it is the only install signal Meta will
ever receive.

### Measurement Protocol vs. gtag, concretely

|  | gtag.js | Measurement Protocol |
|---|---|---|
| Transport | remote script | plain `POST` we make ourselves |
| Credentials | measurement ID | measurement ID **+ `api_secret`** |
| `client_id` | minted and stored in the `_ga` cookie | **we must supply it** (`src/analytics/client-id.ts`) |
| `session_id` | handled automatically | **we must supply it** (`src/analytics/session.ts`) |
| Failure mode | visible in the network tab | `204 No Content` regardless of whether the event was kept |

The last three rows are the whole reason this module is as large as it is.

---

## 2. Event schema

`sidebar_opened` and friends are **not product-prefixed** — no
`dragonsheets_sign_up`, no `ds_connect_amazon`. Each product has its own GA4
property, so nothing collides there; names only collide inside the single
shared Google Ads account, and the fix for that is renaming the imported
*conversion action*, never the GA4 event.

| Event | Fires when | Implemented in | GA4 key event? | Ads conversion? |
|---|---|---|---|---|
| `page_view` | any `site/` page loads | `site/*/index.html` (gtag `config`) | no | no |
| `extension_installed` | `/installed/` loads after a CWS install | `site/installed/index.html` | ✅ key event | secondary |
| `sidebar_opened` | the sidebar panel opens (launcher click or `dsr=` deep link) | `src/app/App.tsx` → `trackSidebarOpened()` | no | no |
| `sign_up` | Google sign-in succeeds — **once per install, ever** | `src/app/routes/Welcome.tsx` → `trackSignUp()` | ✅ key event | secondary — **never primary** |
| `sheet_shared` | "Check access" confirms the service account has Editor rights | `src/app/routes/ShareSpreadsheet.tsx` → `trackSheetShared()` | optional | no |
| **`connect_amazon`** | **any** Amazon connection is first seen in connection state | `src/analytics/events.ts` → `reconcileConnectionActivations()` | ✅ **key event** | ✅ **PRIMARY — the only one** |
| `connect_amazon_seller` | that connection was Seller Central | same | 🚫 **never** | 🚫 not imported |
| `connect_amazon_ads` | that connection was Amazon Ads | same | 🚫 **never** | 🚫 not imported |
| `sync_created` | the sync wizard's `createSync` succeeds | `src/app/routes/syncs/SyncWizard.tsx` → `trackSyncCreated()` | optional | no |
| `agent_prompt_sent` | a prompt is submitted to the AI agent | `src/app/routes/Agent.tsx` → `trackAgentPromptSent()` | no | no |

### Event parameters

| Event | Params |
|---|---|
| `sidebar_opened` | `source` (`launcher` \| `deep_link`) |
| `sign_up` | `method: "google"` |
| `sheet_shared` | — |
| `connect_amazon` | `provider` (`amazon_seller` \| `amazon_ads`) |
| `connect_amazon_seller` / `_ads` | `provider` |
| `sync_created` | `schedule`, `report_count`, `column_count`, `from_template`, `from_agent` |
| `agent_prompt_sent` | `prompt_length`, `turn` |

Plus, on every event: `signup_source`, `session_id`, `engagement_time_msec`.
On the first event of an install and on every `sign_up`/`connect_amazon*`:
the full attribution blob (`utm_*`, `gclid`, `fbclid`, `msclkid`, `referrer`,
`landing_page`).

### User properties

Attached to every event: `signup_source`, `attribution_source`
(`bridge` | `direct`), `utm_source`, `utm_medium`, `utm_campaign`,
`has_gclid`, `has_fbclid`, and — after a connection — `spapi_connected` /
`ads_connected`.

> **Why `has_gclid` rather than the gclid itself.** GA4 truncates
> *user-property* values at **36 characters**. A gclid is around 90. Stored
> as a user property it arrives mangled and silently useless. The full value
> goes in the *event params*, whose limit is 100.

### 🚨 The conversion event is `connect_amazon`

The umbrella, counted **ONE_PER_CLICK** in Google Ads. Decided 2026-08-05
across the whole suite.

- **Why the umbrella and not `connect_amazon_seller`:** some Dragon products
  are usable with an Ads-only connection, so a seller-only conversion
  under-counts them. One event is uniform across every product and survives
  the next launch.
- **Why `One` and not `Every`:** a customer can connect several Amazon
  accounts. Ads defaults GA4 imports to *Every*; left there, one customer
  looks like three conversions and Smart Bidding eventually chases
  multi-account users instead of new customers. `counting_type` is
  **immutable over the API** on GA4 imports — it is a UI-only edit, and the
  single easiest thing to forget.
- **Never star `connect_amazon_seller` / `_ads` as key events.** They are
  *subsets*: one seller connection fires the umbrella **and** the specific
  event. As primaries they double-count; as secondaries they invite someone
  to sum the columns. Keep the segmentation in GA4, where both events are
  still fully queryable.
- **Never wire the conversion to `sign_up`** — it is bot-contaminated.
- Rename the imported Ads action to **`DragonSheets (web) connect_amazon`**,
  and always resolve conversion actions by their GA4 `event_name`, never by
  display name (Google auto-names imports things like "Suggested Goal").

### 🚨 Activations fire from connection state, not from the OAuth popup

`reconcileConnectionActivations()` runs on sidebar mount, reads connections
through the `BackendClient`, and fires anything this install has not already
logged — deduped per connection id in `chrome.storage.local` under
`dragonsheets_activations_v1` (same shape as `frontend-shared`'s
`dragonbot_activations_v1`).

Three things can *nudge* a re-check, and **none of them fires an event**:

| Nudge | Where |
|---|---|
| the mock popup's `postMessage` | `src/app/routes/ConnectAmazon.tsx` |
| `ds-oauth-result` from `go.getdragonsheets.com/oauth-complete/`, re-broadcast by the service worker | `src/background/service-worker.ts` → `broadcastOauthResult()` |
| the sheet tab regaining focus | `src/app/routes/ConnectAmazon.tsx` |

Each one re-reads connections and calls `reconcileConnectionActivations()`;
the reconciler decides whether anything fires. When a popup is blocked, closed
a second early, or navigated back from by hand, the connection still succeeds
server-side — and a message-only path loses the conversion silently. That is
exactly how DragonReply lost its first real connection. Do not reintroduce a
direct fire in any of these handlers.

There is also a **7-day recency gate**: the dedupe list is local storage and
is empty on a machine the user has not installed on before. Without the gate,
installing on a second laptop would re-fire an activation for every account
they already had.

---

## 3. The attribution bridge

### The problem

```
 Google Ads click                  Chrome Web Store                Extension
 ─────────────────                 ────────────────                ─────────
 ?gclid=EAIaIQ…            ──►     "Add to Chrome"        ──►      onInstalled
 landing page captures it          ✂ strips query params           no gclid
 into a first-party cookie         ✂ strips referrer               no referrer
 gtag mints a client_id            ✂ different origin              no cookies
 into the _ga cookie                                               ⇒ brand-new
                                                                     anonymous
                                                                     GA4 user
```

The install is real, the conversion happens later inside the extension, and
nothing joins it back to the click that paid for it.

### The fix

`go.getdragonsheets.com` is a **subdomain of the landing page's domain**, so
it shares eTLD+1 and can read the LP's first-party cookies. The service
worker opens `/installed/` on `chrome.runtime.onInstalled`, and that page
hands everything across:

```
  getdragonsheets.com  (landing page)
  ├── cookie  dragonbot_attribution   → utm_*, gclid, fbclid, referrer, landing_page
  ├── localStorage dragonbot_attribution_v1  (same blob, JSON)
  └── cookie  _ga = GA1.1.<random>.<ts>      → the GA4 client_id
                     │
                     │  cookies scoped to .getdragonsheets.com
                     ▼
  go.getdragonsheets.com/installed/   ← opened by the SW after install
  │
  │   reads all three, then:
  │   chrome.runtime.sendMessage(EXTENSION_ID, {
  │     type: "ds-attribution",
  │     payload: { attribution: {…}, gaClientId: "1739468182.1754438400" }
  │   })
  │
  │   externally_connectable in manifest.json restricts this channel to
  │   https://go.getdragonsheets.com/* — no other site can write our
  │   attribution.
  ▼
  service worker  (src/background/service-worker.ts, onMessageExternal)
  ├── adoptBridgeClientId(gaClientId)     → we become the LP's GA4 user
  ├── storage[ds:attribution] = payload   → attached to MP events
  └── storage[ds:attribution-source] = "bridge"
                     │
                     ▼
  every Measurement Protocol event now carries the SAME client_id as the
  ad click ⇒ GA4 → Ads conversion import attributes it to the gclid
```

**Direct installs** (Web Store search, a shared link, third-party cookies
blocked) never reach the bridge. `onInstalled` writes
`attribution_source: "direct"` up front, so the field is always present and
truthful rather than absent; the bridge overwrites it with `"bridge"` if and
when it arrives.

### Parsing the `_ga` cookie

```
_ga = GA1.1.1739468182.1754438400
      │   │ └──────── the client_id ────────┘
      │   └── domain components stripped — 1 here, 2 or 3 elsewhere
      └────── cookie format version
```

Take the **last two** dot-separated components. Never index positionally: the
second field varies by domain depth. Not to be confused with
`_ga_<CONTAINER>`, the session cookie, which has a different format and
contains no client_id.

### `client_id` stitching precedence — bridge > existing > new

1. **Bridge.** A client_id delivered by `/installed/` wins — *but only while
   no event has yet been accepted by GA4 under a different id.* Past that
   point one user would fork into two and the earlier events would be
   orphaned, so the existing id is frozen and the bridge id is stored as
   `rejectedBridgeId` for diagnosis.
2. **Existing.** Whatever is already in `chrome.storage.local`. Stable for
   the life of the install; never re-minted.
3. **New.** Minted as `<random uint32>.<epoch seconds>` — GA4's own format.

A malformed candidate is refused outright, and re-delivering the same id (the
bridge fires on every `/installed/` visit) is a no-op.

### The bridge's `?debug=1` mode

Append `?debug=1` to `https://go.getdragonsheets.com/installed/`. Nothing is
sent; the payload that *would* be sent is printed to the console. Without the
flag the page still logs a single `[dragonsheets-bridge] {…}` line describing
what it collected and whether the send succeeded.

---

## 4. Implementation map

```
src/analytics/
├── config.ts       GA4_MEASUREMENT_ID / GA4_API_SECRET (both null until
│                   Task 4a is done), DEBUG_ENDPOINT, protocol limits
├── client-id.ts    mint / read / adopt-from-bridge, with the precedence rules
├── session.ts      rolling 30-minute session_id + engagement_time_msec
├── mp.ts           the POST, the PII scrub, the capped offline queue
├── attribution.ts  the stored blob → event params + user properties
├── track.ts        context router: service worker sends, everyone else relays
├── events.ts       the typed event API + activation reconciliation
└── index.ts        the barrel everything else imports
```

**Why the service worker sends and nobody else does.** The sidebar runs as a
content script on `docs.google.com`. A `fetch()` from a content script is
issued in the *host page's* CORS context, so a POST to google-analytics.com
from there is blocked. `track()` detects the context (`typeof document ===
"undefined"`) and relays UI-side events over `chrome.runtime.sendMessage` to
the service worker, which does the send.

**PII.** Nothing identifying is sent, at all. On the web surfaces the PII
boundary in `frontend-shared` routes email and name to *Clarity only* — and
Clarity cannot run in an extension, so here the rule collapses to "no PII
anywhere". `src/analytics/mp.ts` enforces it with a denylist of parameter
names plus an email-shaped-value check, and the harness asserts it. The only
user-scoped value we send is `user_id`, an opaque backend id.

**Offline / unconfigured.** Events are enqueued in `chrome.storage.local`
(cap 50, oldest evicted) and flushed in order on the next successful send, on
`chrome.runtime.onStartup`, and on the existing 6-hourly alarm. A queued
event is replayed with a backdated `timestamp_micros` so an offline session
does not collapse into one instant on reconnect. With null credentials the
module warns **once**, in one structured line, and keeps queueing — dev
builds never crash and never lose events.

---

## 5. Verifying in GA4

### 5a. The `/debug/mp/collect` validation endpoint

`/mp/collect` answers **`204 No Content` for everything** — including
payloads it silently discards. It will never tell you a field is wrong. The
validation endpoint will.

1. Set `DEBUG_ENDPOINT = true` in `src/analytics/config.ts`.
2. `npm run build`, reload the extension at `chrome://extensions`.
3. Open the service worker console (`chrome://extensions` → DragonSheets →
   *Inspect views: service worker*).
4. Trigger an event. Look for `[dragonsheets] {"event":"ga-debug-response",…}`.

An empty `validationMessages` array means the payload is good. Anything else
names the offending field. **Set it back to `false` before shipping** — the
validation endpoint does not record events.

You can also curl it directly:

```bash
curl -s -X POST \
  "https://www.google-analytics.com/debug/mp/collect?measurement_id=G-XXXXXXXXXX&api_secret=YOUR_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "client_id": "1739468182.1754438400",
    "events": [{
      "name": "connect_amazon",
      "params": {
        "provider": "amazon_seller",
        "session_id": "1754438400",
        "engagement_time_msec": 100
      }
    }]
  }' | jq
```

### 5b. DebugView

DebugView only shows traffic explicitly flagged as debug.

- **Web surfaces:** install the *GA Debugger* Chrome extension, or add
  `debug_mode: true` to the `gtag('config', …)` call.
- **Measurement Protocol:** add `"debug_mode": true` to the event params.
  There is no browser flag that can do this for you — MP traffic does not
  come from a browser context GA4 can tag.

Then: GA4 → **Admin → DebugView**, and pick your device in the top-left
selector.

### 5c. The full-funnel check (Phase 5's verify gate)

On a **fresh Chrome profile**, with `DEBUG_ENDPOINT = false` and
`debug_mode: true` temporarily added:

1. Visit the landing page with a `?gclid=TEST123` query. → `page_view`
2. Click the install CTA. → `cta_click`
3. Install from the Web Store, landing on `/installed/`. →
   `extension_installed`
4. Open a Google Sheet, open the sidebar. → `sidebar_opened`
5. Sign in with Google. → `sign_up`
6. Share the sheet, click *Check access*. → `sheet_shared`
7. Connect an Amazon account, then **reopen the sidebar**. →
   `connect_amazon` + `connect_amazon_seller`

**What "passing" looks like:** every one of those events shows the **same
`client_id`** in DebugView, and they appear as **one user**, not two. If step
7 shows a different client_id from step 1, the bridge did not run — check the
`[dragonsheets-bridge]` console line on `/installed/` and confirm
`DRAGONSHEETS_EXTENSION_ID` is set.

**`sign_up` must read exactly 1** for the profile. More than one means the
dedupe flag is not being written; check `chrome.storage.local` for
`ds:ga-signup-logged`.

### 5d. Inspecting local state

Service-worker console:

```js
chrome.storage.local.get(null).then(console.log)
```

| Key | Meaning |
|---|---|
| `ds:ga-client-id` | `{id, source: "bridge"\|"minted", rejectedBridgeId?}` |
| `ds:ga-session` | `{id, startedAt, lastEventAt}` |
| `ds:ga-queue` | un-sent envelopes (should normally be empty) |
| `ds:ga-sent-any` | `true` once GA4 has accepted an event |
| `ds:ga-signup-logged` | `true` once `sign_up` has fired |
| `ds:ga-user-id` | opaque backend user id |
| `ds:attribution` | the raw bridge payload |
| `ds:attribution-source` | `"bridge"` or `"direct"` |
| `dragonsheets_activations_v1` | connection ids already activated |

### 5e. The offline harness

```bash
npm run test:analytics
```

Bundles `test/analytics.harness.ts` with esbuild, runs it under node with
`chrome.*` and `fetch` stubbed, and asserts the payload shape, the `sign_up`
dedupe, activation dedupe, queue ordering and cap, and client_id precedence.
It never contacts GA4 and never drives Chrome — see the file header for the
explicit list of what it does *not* prove.

---

## 6. Known traps (each of these has actually bitten us)

- **`dataLayer.push(arguments)`, never `push(args)`.** A rest-parameter array
  is silently ignored by gtag.js: zero hits, not even `page_view`. This bug
  zeroed a sibling product's GA4 for ten days. Grep every `injectGa4` /
  gtag shim when touching analytics.
- **MP events without `session_id` + `engagement_time_msec` are invisible in
  standard reports.** They appear in DebugView and Realtime, then vanish from
  Events, Conversions, Acquisition and Explorations. Nothing errors.
  `src/analytics/mp.ts` attaches both centrally so no call site can omit them.
- **Do not double-fire `sign_up`.** One per install, ever.
- **Do not optimize any campaign toward `sign_up`** — bot-contaminated.
  `connect_amazon_seller` (real SP-API OAuth) is the bot-proof gate, but the
  *conversion* remains the umbrella.
- **Do not prefix event names per product.**
- **Do not fire activations from the OAuth popup.** Server/connection state
  only.
- **Do not sum `connect_amazon` with `connect_amazon_seller`/`_ads`.** The
  specifics are subsets of the umbrella.
- **Ads defaults GA4 conversion imports to Count = Every.** Change it to
  **One** in the UI; the API cannot.

---

## 7. Open / unverified

| Item | Status |
|---|---|
| `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` | **null** — TODO(user-task), `DRAGONSHEETS_USER_TASKS.md` Task 4a |
| `G-TODOTODO00` / `TODO_CLARITY_ID` / `TODO_META_PIXEL_ID` in `site/` | placeholders — Tasks 4a/4b/4c |
| `DRAGONSHEETS_EXTENSION_ID` in `site/installed/index.html` | empty until the first CWS publish; the bridge is dormant until then |
| A real POST to `/mp/collect` | **never made** — no credentials exist yet |
| The bridge running in a real browser | **never run** — needs a published extension ID and a live `go.` subdomain |
| `connect-src` for `https://www.google-analytics.com` | added to `manifest.json`. If a real send is ever blocked by CORS rather than CSP, the fix is adding `https://www.google-analytics.com/*` to `host_permissions` — deliberately not done pre-emptively, since every host permission is Web Store review friction |
| GA4 key events / Ads conversion import | not created — the property does not exist yet (Phase 2/7) |
