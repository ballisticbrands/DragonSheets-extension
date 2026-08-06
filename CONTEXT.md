# CONTEXT

Orientation for humans and agents landing in this repo cold.

## What this is

`DragonSheets-extension` — the Chrome extension for **DragonSheets**
(`getdragonsheets.com`): Amazon Seller Central + Amazon Ads data delivered
into Google Sheets via a sidebar injected into
`docs.google.com/spreadsheets`. Modeled mechanism-for-mechanism (never
code/copy/assets) on hopted.com — see `sellerconnect/sellerconnect/docs/hopted-teardown.md (private repo)` (private repo).

## Why `-extension`, not `-frontend`

Every other Dragon brand has a `dragon<x>-frontend` web app at
`app.<domain>`. DragonSheets deliberately has **no web app** — the product
surface IS the extension inside Google Sheets. The funnel is:
LP → Chrome Web Store → install → open a Sheet → sidebar. Naming the repo
`-extension` keeps that decision visible (DRAGONSHEETS_PLAN Phase 0.4).

This is the **first extension product in the fleet** — there was no template
to fork (`DragonBot-extension` is internal CDP tooling, not a product). This
repo is intended to become that template for future extension products.

## What's real vs deferred

Real today: the full extension scaffold, onboarding flow (welcome → share
spreadsheet with service account → completed fork), Amazon connect UI with a
mock consent popup, shadow-DOM sidebar with deep-linkable routing, service
worker (installed/uninstalled pages, remote selector-map refresh,
externally_connectable attribution receiver), the go.getdragonsheets.com
static site, CI.

Deferred (all behind the `BackendClient` interface in `src/backend/types.ts`):

- **Real backend** — `sellerconnect` repo, DRAGONSHEETS_PLAN **Phase 8**:
  Google OAuth session exchange, the Sheets writer service account, sync
  pipelines (BigQuery → Sheets), real Amazon connect
  (`POST /v1/connect/amazon-selling-partner/start` + `dragonbot-oauth-result`
  postMessage — the mock already speaks this contract), agent backend,
  billing.
- **Feature screens** — Syncs wizard, AI agent chat, template gallery,
  settings are "Coming online" stubs; next build phase (Phase 4 completion)
  fills them against the same mock.
- **Tracking** — GA4/Clarity/Meta IDs unminted (Phases 2 & 5); placeholder
  comments sit where the snippets go.
- **CWS listing** — Phase 6; release workflow's CWS upload step is commented
  out.

## Load-bearing links

- Plan: `sellerconnect/DRAGONSHEETS_PLAN.md` (this repo = Phases 3–4)
- Teardown: `sellerconnect/sellerconnect/docs/hopted-teardown.md (private repo)` (private repo) (architecture rationale, §9 is the
  imitate/avoid list this codebase follows)
- Branding: `Dragon-marketing/BRANDING.md` (Forest `#2F7D4F`, Lime `#98CC65`,
  Deep `#0F3D2E`, Ink `#1A1A1A`, system font stack)
- Shared package: `ballisticbrands/frontend-shared` (not installable here
  yet — see README "frontend-shared")

## Invariants to preserve

1. **No Google OAuth scopes for Sheets/Drive, ever.** The service-account
   share model is the product's core trust + review-friction advantage.
2. **All Google-owned selectors live in `src/content/selector-map.ts`** and
   must stay remote-overridable via `site/bootstrap.json`.
3. **The sidebar UI never talks to the network directly** — everything goes
   through `BackendClient`, so Phase 8 is a swap, not a rewrite.
4. **Permissions stay minimal.** Every addition is CWS review friction and
   install-prompt fear; justify each one in the README before adding.
5. The `dragonbot_attribution` cookie name and `dragonbot-oauth-result`
   message type are **cross-product contracts** — do not rename.
