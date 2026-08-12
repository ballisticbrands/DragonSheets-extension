# DragonSheets — state of play

**Paused 2026-08-12** to focus elsewhere. This is the pick-up-cold document: what works, what
doesn't, what is deliberately fake, and what to do first when work resumes.

Companion docs: [`README.md`](README.md) (dev loop), [`CONTEXT.md`](CONTEXT.md) (why this repo
exists), [`docs/CWS_LISTING.md`](docs/CWS_LISTING.md) (the store submission, written and
waiting), [`docs/ANALYTICS.md`](docs/ANALYTICS.md). Backend-side docs live in the **private**
`sellerconnect` repo: `DRAGONSHEETS_PLAN.md` (the phase plan), `DRAGONSHEETS_USER_TASKS.md`
(the human checklist), `docs/EXTENSION_API.md` (the API contract — read the "M3 implementation
notes" section, it pins down shapes the contract sketch left open),
`docs/DRAGONSHEETS_DEPLOY.md` (deploy record + runbook), `docs/hopted-teardown.md` (competitor
teardown; kept private deliberately).

---

## Live right now

| Thing | State |
|---|---|
| `https://getdragonsheets.com` | Landing page, 12 prerendered routes, HTTPS enforced |
| `https://go.getdragonsheets.com` | Privacy policy, install/uninstall, `/oauth-complete/`, `bootstrap.json`. HTTPS enforced |
| Backend | Deployed 2026-08-11. `/v1/sheets/*` live, `dragonsheets` brand + CORS registered, sheet-sync cron on a 15-min tick |
| GA4 / Clarity / Meta | Wired and verified firing. GA4 `548983284` / `G-7NC5Q82FB1`, Clarity `xyaewgiiy7`, Meta `2431527440666944` |
| Google Ads | 4 conversion actions, `connect_amazon` primary, all category Other + Count One. **No campaign — deliberately not running traffic** |
| Chrome Web Store | Item exists as a **draft**, ID `papoimmliahhmamjdagmajeddimpmojo`. **Not submitted** |

## Works end to end (verified in a real browser)

- Sidebar injects into Google Sheets, shadow-DOM panel, sits 100px below Google's chrome.
- **Real Google sign-in** — `launchWebAuthFlow` → ID token → `POST /v1/auth/google` → `sc_live_`
  session. The implicit `id_token` grant works with the shared Dragon Suite OAuth client.
- Share-with-service-account onboarding, including "open it for me" driving Google's own dialog.
- Settings showing every Amazon connection, broken ones included, with Reconnect.

## Deliberately fake, and why

Do not mistake these for bugs; each is a decision with a reason.

| Surface | State | Why |
|---|---|---|
| **AI agent** | No backend. Reads answer empty, writes show a sentence | Never built — needs an agent loop over the existing MCP tools |
| **Templates** | Gallery is empty | Their report ids are mock ids; against the live catalog every card would fail at save with `invalid_source`. Needs remapping to real catalog ids |
| **Plan / usage** | Counts are real, limits are display-only | No billing exists anywhere in sellerconnect. Side effect: 15-min and hourly refresh show as "Pro" although the server supports them — ungating is a one-line change |
| **Mock mode** | Default (`npm run build`) | The demo path. `VITE_BACKEND=real` switches both backend and auth; auth follows backend so they cannot disagree |

## Known issues, in the order I would fix them

1. **Second Seller Central account fires no `connect_amazon`.** `listReconcilableConnections()`
   resolves one activation id per *provider*, so a second account of the same provider is
   deduped away. Unreachable until multi-account shipped; live now. Fixing changes conversion
   volume feeding Smart Bidding — a decision, not just a patch.
2. **Templates are empty** (above). Highest-value UI gap once the catalog is real.
3. **`marketplaceIds` never reach the backend** — it scopes a source by connection, not
   marketplace. The wizard uses them locally only.
4. **Text `constant` / `virtual` calculated columns** are refused at save rather than silently
   dropped; the wire format cannot express them. Numeric constants become literal formulas.
5. **1 pre-existing backend test failure** (`src/services/ads/reports.test.ts`), a deterministic
   timing assertion that predates all DragonSheets work. Confirmed by stashing.

## Never verified against production

Honest list — everything below is stubbed-fetch or fixture-tested only:

- The **live `/v1/sheets/*` payloads**. No end-to-end sync has ever run: nothing has been
  written into a real spreadsheet by the real backend.
- The **real Google Sheets DOM**. `test/browser/` runs against `test/browser/sheets-fixture.html`,
  which reproduces the anchors from `selector-map.ts`, not Google's actual markup. If Google
  moves things, `bootstrap.json` on `go.getdragonsheets.com` re-points selectors **without
  shipping an update** — that is the escape hatch, use it.
- The Closure-widget share-dialog behaviour, modelled by the fixture.

## Picking it back up

**To develop:**
```bash
npm install
npm run build                 # mock mode — the demo/QA path
VITE_BACKEND=real npm run build   # real backend + real auth
# chrome://extensions → Load unpacked → dist/
```

**To test:**
```bash
npm run test:unit       # 138 — wire mapping, auth, real backend (stubbed fetch)
npm run test:analytics  # 49  — GA4 Measurement Protocol contract
npm run test:browser    # 16 checks — needs a MOCK build; refuses a real one
npx tsc --noEmit
```
`test:browser` needs Playwright, deliberately not a dependency:
`npm i -D --no-save playwright && npx playwright install chromium`.

**Do not break:** the manifest `key` (pins the extension ID — CI asserts it; without it OAuth
dies on `redirect_uri_mismatch`), the analytics event names (`docs/ANALYTICS.md` — they are the
cross-product Ads contract), and the 100px top offset (a deliberate choice over DOM
measurement, see `src/content/top-offset.ts`).

### The two obvious next moves

**A — ship something real.** Get one end-to-end sync writing into a spreadsheet. Everything is
built and deployed; nobody has run it. That is the last unproven link in the product's core
promise, and it is what makes the store listing honest.

**B — submit the listing.** Everything is prepared: zip builds, five 1280×800 screenshots in
`store-assets/`, all copy and permission justifications in `docs/CWS_LISTING.md`. Submit
**unlisted** while data is still mocked — and retake screenshots 1–3 before going public, since
they show the "Mock mode" footer (left in on purpose; hiding it would imply live syncing we do
not yet do).

Doing **A before B** is the recommendation, and the reason is in `DRAGONSHEETS_USER_TASKS.md`:
a listing that describes live Amazon syncing while the build only mocks it is a
functionality-mismatch rejection risk against a brand-new publisher account. The usual argument
for submitting early — getting a stable extension ID — no longer applies, because the draft
already minted one.

### Still needs a human

- Chrome Web Store submission (above).
- `info@getdragonsheets.com` forwarding — confirm it actually receives mail.
- Rotate the fine-grained GitHub PAT that was pasted in chat; a **classic** token with
  `read:packages` is what GitHub Packages needs if `frontend-shared` is ever wired in (local UI
  primitives mirror its API, so the swap is mechanical).
