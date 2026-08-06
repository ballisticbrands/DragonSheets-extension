# DragonSheets-extension

Chrome extension (MV3): **Amazon Seller Central + Amazon Ads data → Google
Sheets**, delivered as a sidebar injected into `docs.google.com/spreadsheets`.
First extension product in the fleet. Landing page lives in
`DragonSheets-LP` (separate repo, `getdragonsheets.com`); this repo's GitHub
Pages serves the companion site at **go.getdragonsheets.com**.

> Backend is deferred (DRAGONSHEETS_PLAN Phase 8). Everything runs against a
> mocked, typed `BackendClient` — see "Mock mode" below.

## Dev loop

```bash
npm ci
npm run build        # icons + vite build → dist/
# or: npm run dev    # vite build --watch (no HMR — reload the extension)
```

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`. Open any Google Sheet → the green **DragonSheets** pill appears at
the left edge of the Sheets toolbar. After editing code, rebuild and click the
extension's reload button in `chrome://extensions`, then reload the Sheets tab.

Other commands:

```bash
npm run typecheck    # tsc --noEmit (strict)
npm run zip          # dist/ → release/dragonsheets-extension-v<version>.zip
npm run icons        # regenerate placeholder icons (pure-node PNG encoder)
```

## Mock mode

The default (and currently only) build is fully mocked:

- **Backend**: `src/backend/types.ts` defines the `BackendClient` interface
  (auth, sheet access, Amazon connect + linked accounts, sync CRUD/run
  history, report catalog, agent chat with 202-continuation + proposals,
  templates + materialisation, workspace members, plan usage).
  `src/backend/mock.ts` implements it with realistic latencies and state
  persisted in `chrome.storage.local`; `src/backend/catalog.ts` holds the
  static report catalog (14 reports) and the 6 solution templates.
  `getBackend()` (`src/backend/index.ts`) returns the mock; a
  `VITE_BACKEND=real` build will select the Phase-8 real client.
- **Auth**: mock mode signs in instantly with a fake profile. The real path
  (`chrome.identity.launchWebAuthFlow`, service-worker side) is wired but
  dormant — `GOOGLE_OAUTH_CLIENT_ID` in `src/auth/config.ts` is `null`
  (TODO(user-task): create the GCP OAuth client). Build with
  `VITE_AUTH_MODE=real` once configured.
- **Amazon connect**: the consent popup is `mock-oauth.html`, which
  auto-succeeds and posts the same `dragonbot-oauth-result` message the real
  consent callback will post. Phase 8 swaps the popup URL for
  `POST /v1/connect/amazon-selling-partner/start`; the sidebar listener
  doesn't change.
- **Feature screens** run entirely against the mock: the sync wizard writes
  real `Sync` records, "Run now" produces run history and row counts, the
  agent returns keyword-routed answers (some carrying an applyable proposal),
  and templates materialise into prefilled wizard drafts. Calculated-column
  formulas are parsed, validated and previewed client-side by
  `src/lib/formula.ts` — no `eval`, MV3 CSP-safe.
- "Sign out" on the settings page clears all mock state.

### Deep links (`dsr=`)

Every screen is addressable on the live Sheets URL, sub-state included:

| Link | Opens |
|---|---|
| `?dsr=syncs` | sync list |
| `?dsr=sync-new&dsp-step=columns` | wizard, columns step |
| `?dsr=sync-new&dsp-template=tpl-tacos` | wizard prefilled from a template |
| `?dsr=sync-detail&dsp-id=<syncId>` | one sync + its run history |
| `?dsr=templates&dsp-category=advertising` | filtered template gallery |
| `?dsr=settings&dsp-tab=plan` | settings, plan & usage tab |

## Architecture

```
public/content-loader.js      manifest-declared loader shim (plain JS)
        │  dynamic import()
        ▼
src/content/index.tsx         real content module (web_accessible, self-executing)
  ├─ selector-map.ts          ALL Google-owned selectors in one place;
  │                           remote-overridable via /bootstrap.json;
  │                           MutationObserver waitFor() — no one-shot lookups
  ├─ launcher.ts              "DragonSheets" pill in the Sheets toolbar
  │                           (plain DOM + inline styles; floating fallback)
  └─ mount.tsx                fixed right-side panel host; React app inside a
                              SHADOW DOM root; Tailwind injected as a
                              constructed stylesheet (no style bleed either way)
src/app/                      sidebar React app
  ├─ router.ts                state router mirrored into a dsr=<route> query
  │                           param on the Sheets URL (deep-linkable, Back/
  │                           Forward works — hopted's trick)
  └─ routes/                  welcome → share-spreadsheet → onboarding-completed
                              → home; connect-amazon; agent (chat + proposals);
                              templates (gallery); settings (5 tabs);
                              syncs/ (list, 6-step wizard, per-sync detail +
                              calculated-column editor)
src/analytics/                GA4 via the Measurement Protocol (gtag.js can't
                              run under MV3): client-id stitching, rolling
                              session, PII scrub, capped offline queue, the
                              typed event API — see docs/ANALYTICS.md
src/backend/                  BackendClient interface + MockBackend
src/auth/                     mock + dormant real Google sign-in
src/background/               module service worker: installed/uninstalled
                              pages, bootstrap.json refresh (alarms),
                              onMessage router, externally_connectable
                              attribution receiver
src/ui/                       local Button/Input/Card/etc (see below)
site/                         go.getdragonsheets.com (GitHub Pages):
                              /privacy /installed /uninstalled /bootstrap.json
```

Key decisions (rationale in `sellerconnect/sellerconnect/docs/hopted-teardown.md (private repo)` (private repo) §9 and `CONTEXT.md`):

- **Service-account model**: the extension holds **no Google OAuth scopes**;
  users share the spreadsheet with
  `dragonsheets@dragonbot-487712.iam.gserviceaccount.com` (placeholder —
  TODO(user-task)) and all sheet I/O happens server-side (Phase 8).
- **Permissions are minimal**: `storage`, `alarms`, `identity` (the dormant
  real-auth path uses it; drop it before CWS submission if auth ships
  server-side instead). No `tabs`, `webRequest`, `cookies`.
- **Remote selector map**: Google DOM changes are fixed by editing
  `site/bootstrap.json` (deployed in minutes), not by shipping a new
  extension build through CWS review.
- **Vanilla Vite multi-entry, not CRXJS** — reasons documented in
  `vite.config.ts`.
- Every selector miss logs one structured `[dragonsheets] {json}` console
  line.

## frontend-shared

`@ballisticbrands/frontend-shared@0.4.1` could **not** be installed here:
GitHub Packages returned `E403 permission_denied — token does not match
expected scopes`. The local `gh` CLI token has scopes
`admin:public_key, gist, read:org, repo, workflow` but **not
`read:packages`**, and no `NODE_AUTH_TOKEN` env var is set on this machine.
TODO(user-task): mint a PAT with `read:packages`, export it as
`NODE_AUTH_TOKEN`, and swap `src/ui/{Button,Input}.tsx` for the shared
components (they intentionally mirror the shared API). The `.npmrc` is
already in place; CI would also need the registry/auth install step from the
frontend-shared README.

## Static site (go.getdragonsheets.com)

Deployed from `site/` by `.github/workflows/pages.yml`. The CNAME file lives
at `site/CNAME` (the artifact root — this repo has no web build step, so
there is no `public/` for the site). DNS: add a `go` CNAME →
`ballisticbrands.github.io.` at Namecheap (TODO(user-task)).

`/installed/` contains the **attribution bridge**: it reads the
`dragonbot_attribution` cookie (domain `.getdragonsheets.com`, set by the LP),
`localStorage["dragonbot_attribution_v1"]`, and the GA4 `client_id` parsed out
of the `_ga` cookie, then hands the lot to the extension via
`chrome.runtime.sendMessage(EXTENSION_ID, {type: "ds-attribution", payload})`
(externally_connectable). The extension ID constant is empty until the first
CWS publish (TODO(user-task)) — until then the bridge is dormant but still
logs, and `?debug=1` prints the payload it would have sent. Mechanism and
diagram: [`docs/ANALYTICS.md`](docs/ANALYTICS.md) §3.

All four `site/` pages carry the standard tracking stack; `/installed/` also
fires `extension_installed` (web-side, so Meta sees it — the extension itself
can only reach GA4).

## Analytics

Full spec — event schema, bridge diagram, DebugView runbook:
**[`docs/ANALYTICS.md`](docs/ANALYTICS.md)**. The short version:

- MV3 forbids remote code, so **gtag.js cannot run inside the extension**.
  In-extension events reach GA4 through the **Measurement Protocol**, POSTed
  from the service worker (`src/analytics/`). The `site/` pages are ordinary
  web pages and carry the normal gtag + Clarity + Meta stack.
- The Chrome Web Store strips every query param, referrer and cookie, so
  `site/installed/index.html` is an **attribution bridge**: it reads the LP's
  `dragonbot_attribution` cookie, `dragonbot_attribution_v1` localStorage and
  the GA4 `client_id` out of the `_ga` cookie, then hands them to the
  extension over `externally_connectable`. The extension adopts that
  `client_id` — which is what makes an ad click and an in-extension
  conversion one GA4 user instead of two.
- Event names are **not product-prefixed**: `sidebar_opened`, `sign_up`,
  `sheet_shared`, `connect_amazon` (+ `_seller` / `_ads`), `sync_created`,
  `agent_prompt_sent`. **`connect_amazon` is THE Google Ads conversion**,
  counted ONE_PER_CLICK; the specific two are segmentation only and are never
  summed with it.
- Activations fire from **connection state** on sidebar mount, never from the
  OAuth popup's postMessage.

```bash
npm run test:analytics   # headless harness: payload shape, PII scrub, dedupe,
                         # queue order + cap, client_id precedence
```

## Tracking IDs

| Property | ID | Where it goes | Status |
|---|---|---|---|
| GA4 measurement ID | — | `src/analytics/config.ts` (`GA4_MEASUREMENT_ID`) **and** `G-TODOTODO00` in `site/**/index.html` | TODO(user-task) — `DRAGONSHEETS_USER_TASKS.md` **Task 4a** |
| GA4 MP `api_secret` (extension) | — | `src/analytics/config.ts` (`GA4_API_SECRET`) | TODO(user-task) — **Task 4a**, step 6 |
| Clarity project (web surfaces only) | — | `TODO_CLARITY_ID` in `site/**/index.html` | TODO(user-task) — **Task 4b** |
| Meta dataset (web surfaces only) | — | `TODO_META_PIXEL_ID` in `site/**/index.html` — head snippet **and** the `<noscript>` img | TODO(user-task) — **Task 4c** |
| CWS extension ID | — | `DRAGONSHEETS_EXTENSION_ID` in `site/installed/index.html`; also the `src/auth/config.ts` redirect URI | TODO(user-task) — Phase 6 (CWS mints it at first publish) |

The `site/` pages deliberately use the **same placeholder strings as the
landing page** (`G-TODOTODO00`, `TODO_CLARITY_ID`, `TODO_META_PIXEL_ID`), so a
single find-and-replace across `DragonSheets-LP` and this repo's `site/`
covers every surface at once. Each must be a **new per-product**
property/project/dataset — never another Dragon product's IDs.

## CI

- `ci.yml` — typecheck + build + zip artifact on every push/PR.
- `pages.yml` — deploys `site/` to GitHub Pages on push to main.
- `release.yml` — tag `vX.Y.Z` → GitHub release with the zip; CWS upload
  step present but commented out (needs CWS credentials).

## Related

- `CONTEXT.md` — why this repo exists, what's deferred, links.
- `sellerconnect/sellerconnect/docs/hopted-teardown.md (private repo)` (private repo) — full competitor teardown this architecture is
  based on.
- `sellerconnect/DRAGONSHEETS_PLAN.md` — the phase plan (this repo is
  Phases 3–4).
