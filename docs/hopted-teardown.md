# Hopted v3.59 — Architecture & Flow Teardown

**Subject:** `Hopted: Amazon, E-commerce Connector for Google Sheets`, MV3, version 3.59
**Purpose:** mechanism study for DragonSheets (React/TS competitor). No code, assets, or copy-text is reproduced here — only structural facts, identifiers, and short evidential fragments needed to describe behaviour.
**Bundle:** Vue 3 + Vuetify 3.11.7 + Pinia, built with Vite/rolldown, minified with backtick-string output. ~163 files in `assets/`.

---

## 0. Executive model (read this first)

The single most important architectural fact: **the extension never touches the Google Sheets API and holds no Google OAuth scopes.**

- The user signs into Hopted's *backend* with Google (server-side OAuth) — the extension only opens a popup window.
- The user then **shares the spreadsheet with a GCP service account** (`hopted@hopted.iam.gserviceaccount.com`, from `mixpanel-wrapper-Dj6YYDii.js: static getGcpServiceAccountEmail(){return \`hopted@hopted.iam.gserviceaccount.com\`}`).
- From then on, **all reading and writing of cells is done server-side** by the backend using the Sheets API as that service account.
- The extension is a *control surface + context sensor*: it renders UI inside the Sheets page, reads a handful of DOM facts (active range, sheet names, spreadsheet title, gid), and issues commands to the backend.

This is why the permission set is so small and why there is no `identity` permission, no `https://www.googleapis.com/*` host permission, and no OAuth2 client in the manifest. It is the design decision to copy.

Data flow:

```
Sheets page DOM  ──(Vue app, in-page)──┐
                                       │ chrome.runtime.sendMessage (typed enum)
                                       ▼
                             MV3 service worker
                              │            ▲
                    fetch(REST)│            │ SignalR (WebSocket) push
                              ▼            │
                    https://app.hopted.com/api/v1  +  /hopted-hub
                              │
                              └── Google Sheets API (service account) ──> the user's spreadsheet
```

---

## 1. Manifest anatomy

File: `manifest.json`

### 1.1 Identity / lifecycle
| Field | Value |
|---|---|
| `manifest_version` | 3 |
| `version` | 3.59 |
| `update_url` | `https://clients2.google.com/service/update2/crx` (self-hosted-style pin; also CWS-listed) |
| `homepage_url` | `https://www.hopted.com` |
| `key` | present (pins the extension ID across dev/prod builds) |
| `options_page` | `settings.html` |
| `action` | icon only, **no popup** — clicking the toolbar icon opens the options page (see §8) |

### 1.2 Permissions (7)
```
tabs, alarms, cookies, storage, webRequest, webNavigation, system.display
```
Notably **absent**: `identity`, `scripting`, `activeTab`, `offscreen` (despite `offscreen/*` being listed in web_accessible_resources — dead entry), `declarativeNetRequest`.

Why each is there (traced to code):

| Permission | Actual use |
|---|---|
| `tabs` | `chrome.tabs.query({url:"https://docs.google.com/spreadsheets/*"})` to broadcast SignalR pushes to every open Sheets tab; `chrome.tabs.remove` to auto-close the OAuth popup tab; `chrome.tabs.create/update` for the post-install page. |
| `alarms` | 1-minute `keepAlive` alarm to revive the SW and re-assert the WebSocket; `signalRReconnect` alarm as a setTimeout replacement that survives SW suspension. |
| `cookies` | **Affiliate attribution only.** `chrome.cookies.get({url:"https://www.hopted.com", name:"_fprom_ref"})` → posts to `/affiliate/set-referral`. Provider table: `[{providerName:"FirstPromoter",cookieName:"_fprom_ref"}]`. Not used for auth. |
| `storage` | `chrome.storage.local["ApiKey"]`; `chrome.storage.session` for the workspace id. |
| `webRequest` | **Two auth-critical sniffers** (see §4). Observe-only (`responseHeaders` extraInfoSpec, no blocking). |
| `webNavigation` | `onHistoryStateUpdated` on Sheets URLs → detect sheet-tab switches (gid change) without polling. |
| `system.display` | Centre the Amazon OAuth popup window on the primary monitor (`chrome.system.display.getInfo` → `chrome.windows.create({left,top,height:800,width:700})`). |

### 1.3 host_permissions (3)
```
*://*.hopted.com/*
https://docs.google.com/*
https://api-eu.mixpanel.com/*
```

### 1.4 content_scripts (single entry)
```
matches:  https://docs.google.com/spreadsheets*/*edit*
run_at:   document_end
js:       assets/content-script.ts-loader-COTJPsRj.js
css:      38 stylesheets (see below)
```
- The match pattern deliberately requires `/edit` — the app does not load on `/preview`, `/copy`, `/htmlview`.
- The declared JS is a ~15-line **loader shim** only. It does `chrome.runtime.getURL("assets/content-script.ts-BdM2a1rz.js")` then a dynamic `import()`, and calls the exported `onExecute({perf:{injectTime,loadTime}})`. Everything real lives in a web-accessible ES module, which lets the whole app use native ESM code-splitting and lazy `import()` inside a content script.
- **All 38 CSS files are injected eagerly at document_end**, even though the corresponding JS chunks are lazy. Consequence: every Sheets tab pays ~800 KB of CSS parse cost on load (plus `vuetify-3.11.7.css` at 637 KB injected later via a `<link>`). This is a performance mistake worth not copying.

CSS categories in the content_scripts list: Agent (4), Amazon integrations (3), SolutionTemplate (2), Property editors (2), Pipeline dialogs/filters (7), Writebacks (1), Help (2), Settings (6), Onboarding (3), announcements/changelog (4), misc/base (4).

### 1.5 web_accessible_resources
One entry, `matches: ["https://docs.google.com/*"]`, `use_dynamic_url: false` (so URLs are stable and enumerable — a fingerprinting surface, and it also means anyone can fetch the chunk list). It begins with a blanket `assets/*` and then redundantly lists ~130 specific files.

**Screen/feature inventory derived from the resource list** (this is effectively their sitemap):

| Area | Chunks |
|---|---|
| **Bootstrap / shell** | `rolldown-runtime`, `vendor`, `_plugin-vue_export-helper`, `app-startup`, `app-navigation`, `plugins`, `enums`, `i18n-helper`, `content-script.ts`, `content-script-assets` |
| **Onboarding** | `OnboardingWelcome`, `OnboardingShareServiceAccount`, `SocialMediaDialogContainer`, `OnboardingCompletedRoute` |
| **Pipeline (their word: "sync") wizard** | `PipelineSettingsDialogContainer`, `PipelineIntegrationSelectionDialogContainer`, `PipelineIntegrationTableDialogContainer`, `PipelineFiltersDialogContainer`, `PipelineFilterContainer`, `PipelineFilterType{String,Number,Date,DateTime,Boolean}`, `PipelineScheduleDialogContainer`, `PipelineOverviewDialogContainer`, `PipelineSetupSuccessDialogContainer`, `PipelineUpgradePromptDialogContainer`, `PipelineDataSourceList`, `PipelineViewHeader`, `PipelineSpreadsheetInDifferentWorkspace`, `NewPipelineCta`, `active-pipeline`, `active-pipeline-data-refresher`, `pipeline-immutable-options` |
| **Column / property system** | `PropertyFormula`, `PropertyConstant`, `PropertyVirtual`, `PropertyUnion`, `PropertyConvertToValue`, `PropertyInitialValue`, `PropertySyncDirection` |
| **Writebacks** | `WritebacksDialogContainer`, `WritebacksFaqDialogContainer`, `writebacks`, `spreadsheet-utils` |
| **AI Agent** | `StandaloneAgentContainer`, `AgentLaunchDialogContainer`, `AgentInitialPrompt`, `agent`, `agent-analytics`, `agent-onboarding-transition`, `agent-typed-placeholder`, `agent-prompt-context`, `agent-error-messages`, `AIInstructionsDialogContainer`, `AIInstructionsConfirmationDialogContainer`, `ExtractUnstructuredDataDialogContainer` |
| **Solution templates** | `SolutionTemplatesDialogContainer`, `SolutionTemplateIntegrationSelectionDialogContainer`, `SolutionTemplateSetupSuccessDialogContainer` |
| **Integrations / auth** | `AmazonSp`, `AmazonVc`, `AmazonAds`, `IntegrationAuthButton`, `SettingsIntegrationAuthMenu`, `ConnectIntegrationDialogContainer`, `integration-account` |
| **Settings** | `SettingsDialogContainer`, `SettingsCore`, `SettingsOverview`, `SettingsIntegrations`, `SettingsWorkspaceMembers`, `SettingsPlans`, `SettingsBilling`, `SettingsUsage`, `SettingsMyProfile`, `SettingsIntegrationCta` |
| **Announcements / status** | `announcements`, `useEphemeralAnnouncement`, `AnnouncementDot`, `InlineAnnouncement`, `ChangelogDialogContainer`, `NavigationSidebarExpandedIncidents` |
| **Help / growth** | `HelpDialogContainer`, `HelpContactUsDialogContainer`, `ConciergeDialogContainer`, `SetupHelpFromTeammember`, `SubscriptionRequiredBanner`, `FeatureUnavailableDialogContainer`, `BrandedFooter`, `use-social-channels`, `LinkedSpreadsheetsDialogContainer` |
| **Shared UI** | `ViewHeader`, `DialogCloseAction`, `Autocomplete`, `DatePicker`, `toast`, `spreadsheet` |
| **Analytics** | `mixpanel-wrapper` (2.5 MB — see §7) |

### 1.6 CSP
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; connect-src https://*.hopted.com wss://*.hopted.com https://api-eu.mixpanel.com"
}
```
`wss://*.hopted.com` is the tell for the SignalR WebSocket. Note this CSP governs `settings.html` only — the content script runs under **docs.google.com's** CSP, which is why Vuetify's CSS is loaded via a `<link href=chrome.runtime.getURL(...)>` (allowed as a web-accessible resource) rather than an inline `<style>`.

### 1.7 externally_connectable
**Absent.** The hopted.com web app cannot `chrome.runtime.sendMessage` into the extension. All cross-context signalling instead goes through the `webRequest` header sniffer (§4) — a deliberate, and slightly unusual, choice.

---

## 2. Sheets injection mechanism

Files: `assets/content-script.ts-loader-COTJPsRj.js` (shim), `assets/content-script.ts-BdM2a1rz.js` (app), `assets/app-navigation-DiqmjWFR.js` (DOM constants + Sheets helpers), `assets/content-script-4gKz18QE.css`.

### 2.1 Not an iframe — an in-page Vue mount

There is **no** `createElement("iframe")` anywhere in the content script, and the only `chrome.runtime.getURL` call is for the Vuetify stylesheet. The app mounts directly into the Sheets document, sharing its DOM and JS realm.

Bootstrap sequence (single function, called immediately at module evaluation):

```js
function In(){
  let e=document.getElementById(Ye.DocsBarId);           // "docs-bars"
  if(!e){ console.log(`... DOM element cannot be found in Google Sheet's document`); return }
  Ln(); Rn();                                            // create the two teleport anchors
  let t=document.createElement(`link`);
  t.setAttribute(`href`, chrome.runtime.getURL(`vuetify-3.11.7.css`));
  t.onload=()=>{
    let t=document.createElement(`div`), n=`hopted-app`;
    t.id=n; e.after(t);                                  // sibling AFTER #docs-bars
    let r=ie(Fn); Ct(r); r.config.errorHandler=…; r.mount(`#${n}`)
  };
  document.head.append(t)
}
```

Key points:
1. **Single anchor element**: `<div id="hopted-app">` inserted as the *next sibling* of `#docs-bars` (the Sheets top chrome container). Using `.after()` rather than appending to `<body>` puts it inside the Sheets flex layout, so the drawer participates in Sheets' own layout box instead of floating over it.
2. **CSS-gated mount**: the Vue app is not mounted until the Vuetify stylesheet's `load` event fires. Prevents a FOUC of unstyled Vuetify markup on top of the user's spreadsheet.
3. A `config.errorHandler` is installed that resolves the failing component name from `$options.name || _componentTag || __file` and ships it to the backend log gateway (`/LogGateway/log`). Good practice: they know when a Sheets change breaks a component in the wild.

### 2.2 Two teleport anchors punched into Google's chrome

```js
function Ln(){                                    // toolbar button anchor
  let e=document.getElementById(Ye.DocsToolbarId);            // "docs-toolbar"
  if(!e) return;
  let t=document.createElement(`div`);
  t.id=q.DocsToolbarHoptedDomId;                              // "t-hopted-app"
  t.setAttribute(`style`,`display: inline-block; position: relative; margin: 0 4px 0 8px;`);
  e.insertBefore(t, e.firstChild)                             // FIRST child of the toolbar
}
function Rn(){                                    // titlebar status anchor
  try{
    let e=document.getElementById(Ye.DocsPresenceContainerId); // "docs-presence-container"
    if(!e) return;
    let t=document.createElement(`div`);
    t.id=q.DocsTitlebarLastSyncCheckHoptedDomId;               // "docs-hopted-check-last-sync-time"
    t.setAttribute(`class`,`goog-inline-block`);               // borrow Google's own layout class
    e.parentNode.insertBefore(t,e)                             // just left of the avatar cluster
  }catch{}
}
```

Both are then filled by Vue `<Teleport>` from inside the single app:
- `QuickStart` component: `let u = T(\`#${q.DocsToolbarHoptedDomId}\`)` — the toolbar entry button.
- `DocsTitlebar` component: `let t = T(\`#${q.DocsTitlebarLastSyncCheckHoptedDomId}\`)` — a per-sheet sync-status chip.

This is the pattern worth copying: **one Vue/React root, N teleported/portalled fragments into pre-created plain `<div>` anchors.** You get one store, one router, one lifecycle, but UI in three separate places in Google's DOM.

### 2.3 The Sheets DOM contract

All coupling to Google's markup is centralised in one class in `app-navigation-DiqmjWFR.js` — a single blast radius:

```js
class P {
  static DocsBarId=`docs-bars`;
  static DocsToolbarId=`docs-toolbar`;
  static DocsTitleInputLabelInnerId=`docs-title-input-label-inner`;
  static DocsTitlebarShareClientButtonId=`docs-titlebar-share-client-button`;
  static DocsPresenceContainerId=`docs-presence-container`;
  static TNameBoxId=`t-name-box`;
  static DocsSidekickButtonContainerId=`docs-sidekick-button-container`;
  static AppsElementsSidekickRootClass=`appsElementsSidekickRoot`;
  static DocsCompanionAppSwitcherContainerClass=`docs-companion-app-switcher-container`;
  static DocsCompanionAppSwitcherContainerCollapsedClass=`docs-companion-app-switcher-container-collapsed`;
  static DocsSidekickSideSheetRootClass=`docsSidekickSideSheetRoot`;
  static DocsSheetContainerBarClass=`docs-sheet-container-bar`;
  static DocsSheetTabClass=`docs-sheet-tab`;
  static DocsSheetTabNameClass=`docs-sheet-tab-name`;
  static DocsSheetAddButtonClass=`docs-sheet-add-button`;
  static DocsIconClass=`docs-icon`;
  static GoogInlineBlockClass=`goog-inline-block`;
}
```

Operations built on it (class `F` in the same file):

| Operation | Mechanism |
|---|---|
| Read current selection | `getActiveRange()` → `document.getElementById("t-name-box").value` (the A1 Name Box `<input>`). This is the entire selection-tracking implementation — no canvas/grid introspection. |
| Read spreadsheet title | `#docs-title-input-label-inner` textContent, falling back to `document.title` truncated at the first `-`. |
| List sheet names | `document.querySelectorAll(".docs-sheet-tab-name")` → textContent. |
| Switch to a sheet | `findSheetTabElement(name)` walks up from the tab-name node to the `.docs-sheet-tab` ancestor, then **synthesises** `keydown` + `keypress` KeyboardEvents with `key:"Enter", keyCode:13, bubbles:true, cancelable:true`. They never call `.click()` on Sheets controls — Closure-based Sheets widgets respond to keyboard activation more reliably. |
| Add a sheet | Same synthetic-Enter trick on `.docs-sheet-add-button`. |
| Read the signed-in Google account | Scans every `<a>` for an `aria-label` containing `@`, then extracts the address from the trailing `(…)`. Extremely brittle and locale-dependent. |
| Decorate sheet tabs with integration logos | Clones an existing Sheets icon node (`a=e.cloneNode(true)`), re-classes it as `docs-icon goog-inline-block <own-class>` and injects it next to the tab name. Inheriting Google's own icon element means sizing/alignment tracks Google's CSS automatically. |
| Suppress Google's Gemini side panel | `getGeminiSidekickRootSelector()` → `.appsElementsSidekickRoot.docsSidekickSideSheetRoot`; picks the right root heuristically (`rect.left > innerWidth*0.45 && rect.height > innerHeight*0.3`), then clicks `button[aria-label="Close"], [role="button"][aria-label="Close"]`, falling back to re-clicking the entrypoint button. They actively evict the competing panel to claim the right-hand real estate. |

### 2.4 Toggle, sizing, resize, drag

- **Open**: clicking the toolbar teleport button runs a gate (see §5.4) that either opens the drawer (`openNavigationSidebar()`) or routes to onboarding.
- **Close**: `document.addEventListener("keydown", …)` where `e.key === "Escape"` calls `closeNavigationSidebar()` + `closeAppFeature()`. Plus normal Vuetify overlay dismissal.
- **Sizing**: a Vuetify navigation drawer with fixed widths; the modal feature dialogs are hard-pinned by injected CSS:
  ```css
  .hopted-dialog-container{width:40rem!important;max-width:40rem!important;max-height:620px!important}
  .hopted-dialog-container-fixed-height{height:calc(100vh - 16px)!important}
  ```
- **No drag-to-resize handle exists.** There is a `window.addEventListener("resize", …)` for responsive recomputation only. Widths are fixed. (An opportunity for DragonSheets.)
- **Overlay containment** — the two most important lines of injected CSS, because Vuetify's overlay assumes it owns `<body>`:
  ```css
  .v-overlay-container{width:100vw!important;height:100vh!important;position:fixed!important}
  .v-overlay{position:fixed!important}
  ```
  Without these, an overlay mounted inside `#docs-bars`' subtree would be clipped by Sheets' own overflow/transform contexts.
- **No Shadow DOM.** No `attachShadow` anywhere. They accept style bleed in both directions and manage it with Vuetify's `data-v-*` scoped attributes plus `!important`. This is a real risk: Sheets' `goog-*` global CSS can and does collide.
- **No MutationObserver anywhere in the bundle.** They do a one-shot read of `#docs-bars` at `document_end` and give up (with a console log) if it's missing. If Google renders the bar late, the extension silently does not appear until reload. This is a genuine fragility and DragonSheets should do better (see §9).

---

## 3. Messaging architecture

### 3.1 Content script ↔ page
None. No `window.postMessage`, no injected page-world script, no `MAIN` world execution. The Vue app runs in the isolated content-script world and reaches Sheets purely through DOM reads and synthetic events.

### 3.2 Content script ↔ service worker

One-shot `chrome.runtime.sendMessage` request/response only — **no long-lived `chrome.runtime.connect` ports anywhere**. Every message is `{type: <SCREAMING_SNAKE>, …payload}` and every response is `{success:boolean, data?, error?}`.

The type enum lives in `assets/enums-lgCojS3C.js` (also inlined into the SW). Full list:

**Workspace / profile**
`HEALTH_CHECK`, `SWITCH_WORKSPACE`, `CHANGE_WORKSPACE_NAME`, `CHANGE_WORKSPACE_TIMEZONE`, `GET_WORKSPACE_TIME_ZONES`, `FETCH_WORKSPACE_MEMBERS`, `ADD_WORKSPACE_MEMBER`, `DELETE_WORKSPACE_MEMBER`, `UPDATE_USER_LOCALE_PREFERENCE`, `UPDATE_USER_SOCIAL_MEDIA_PREFERENCE`

**Billing**
`GET_BILLING_PLAN_INFO`, `GET_BILLING_ADDONS`, `GET_BILLING_PLAN_WORKSPACE_CONTEXT`, `CHECK_BILLING_FEATURE_ACCESS`, `ACTIVATE_BILLING_ADDON`, `PREVIEW_BILLING_CHECKOUT_ADDON_ADJUSTMENT`, `APPLY_BILLING_CHECKOUT_ADDON_ADJUSTMENT`, `CREATE_CHECKOUT_SESSION`, `CREATE_CUSTOMER_PORTAL_SESSION`

**Bootstrap**
`GET_APP_INIT_DATA`, `GET_SETTINGS_PAGE_INIT_DATA`, `REFRESH_ACTIVE_PIPELINE_DATA`

**Integration accounts**
`GET_ALL_WORKSPACE_INTEGRATION_ACCOUNTS`, `GET_INTEGRATION_ACCOUNTS_OF_ONE_TYPE`, `RENAME_INTEGRATION_ACCOUNT`, `SET_INTEGRATION_ACCOUNT_DISABLED`, `SET_INTEGRATION_ACCOUNTS_DISABLED`, `OPEN_AUTH_WINDOW`, `CLOSE_AUTH_WINDOW`, `GET_AMAZON_SP_AUTH_URLS`, `GET_AMAZON_VC_AUTH_URLS`, `GET_AMAZON_ADS_AUTH_URLS`

**Spreadsheet plumbing**
`SPREADSHEET_SHARING_AUTH_CHECK`, `SPREADSHEET_SHARING_SETTINGS_CHANGED`, `SYNC_SHEET_NAME_WITH_BACKEND`, `ADD_SHEET`, `SWITCH_BETWEEN_SHEETS`, `GET_RANGE_LAST_SYNC_TIME`, `GET_LINKED_SPREADSHEETS`, `GET_USAGE_STATS`

**Pipelines**
`SETUP_PIPELINE`, `DUPLICATE_PIPELINE`, `DELETE_PIPELINE`, `DELETE_ALL_PIPELINES_IN_SPREADSHEET`, `GET_PIPELINE_FILTER_OPTIONS`, `GET_PIPELINE_INTEGRATION_TABLE_OPTIONS`, `VALIDATE_PIPELINE_INTEGRATION_TABLE_PARAMETERS`

**Writebacks**
`DETECT_WRITEBACKS`, `COMMIT_WRITEBACKS`

**Templates & AI**
`GET_SOLUTION_TEMPLATES`, `USE_SOLUTION_TEMPLATE`, `SUBMIT_AI_INSTRUCTIONS`, `AGENT_CHAT`, `AGENT_CHAT_CONTINUE`, `AGENT_SAVE_PENDING_DRAFTS`, `AGENT_CLEAR_CHAT`, `AGENT_FEEDBACK`

**Announcements / incidents**
`GET_ACTIVE_EPHEMERAL_ANNOUNCEMENTS`, `GET_LATEST_CHANGELOG_ANNOUNCEMENTS`, `MARK_AS_SEEN_ANNOUNCEMENT`, `GET_INCIDENTS`, `MARK_INCIDENTS_AS_SEEN`

**SW → content-script pushes** (SignalR relays, prefixed `SignalR_` in source)
`INIT_SIGNALR`, `SHEET_DATA_LOADING_STARTED`, `NOTIFY_APP_USER`, `ANNOUNCEMENT_MARKED_AS_SEEN`, `WORKSPACE_INCIDENTS_SEEN_STATE_CHANGED`, `PIPELINE_CHANGED`, `INCIDENTS_CHANGED`, `WRITEBACK_STATUS`, `SHOW_TOAST`

Note that the SW derives `spreadsheetId` and `sheetId` **from `sender.tab.url`**, never from the message body — a nice tamper-resistance property:
```js
async function Y(e,t){
  if(!t.tab?.url) throw Error(`Sender tab URL unavailable`);
  return { spreadsheetGoogleId: await u.getGoogleSpreadsheetId(t.tab.url),
           sheetGoogleId: e.sheetGoogleId ?? null, pipelineId: e.pipelineId ?? null }
}
```
Spreadsheet id is parsed with `url.match(/\/d\/([^\/]+)/)` after asserting the URL starts with `https://docs.google.com/spreadsheets/d/`.

### 3.3 Service worker → backend (REST)

Base: `https://app.hopted.com/api/v1` (`getApiBaseUrl()`), origin `https://app.hopted.com` (`getBaseOriginUrl()`).

Common request shape: `fetch(url, {headers: {"X-Extension-Version": chrome.runtime.getManifest().version}})`. Mutations add `Content-Type: application/json` and use `PUT` or `POST`.

**Authentication is `?apiKey=<token>` in the query string on most endpoints** — see §4.4 for why this matters.

Full discovered endpoint table (from the URL-builder class in `mixpanel-wrapper-Dj6YYDii.js`):

| Area | Path |
|---|---|
| Logging | `POST /LogGateway/log` |
| Auth | `GET /GoogleAuth/login?browserTimezoneOffsetMinutes=&timezone=&locale=` |
| Auth | `/GoogleAuth/callback` (sniffed, not called by the extension) |
| Auth | `GET /GoogleAuth/spreadsheets-access?apiKey=&spreadsheetId=` |
| Bootstrap | `GET /appinit/bootstrap?spreadsheetId=&apiKey=` |
| Bootstrap | `GET /appinit/bootstrap-settings?apiKey=` |
| Bootstrap | `GET /appinit/active-pipelines?apiKey=&spreadsheetGoogleId=` |
| Workspace | `PUT /workspace/switch?apiKey=&targetWorkspaceId=` |
| Workspace | `/workspace/change-name?apiKey=&workspaceId=&name=` |
| Workspace | `/workspace/change-timezone?apiKey=&workspaceId=&timeZoneId=` |
| Workspace | `GET /workspace/timezones?apiKey=` |
| Workspace | `GET /workspace/get-incidents?apiKey=&workspaceId=` |
| Workspace | `POST /workspace/mark-incidents-as-seen` |
| Members | `GET /WorkspaceMembership/get-members?apiKey=&workspaceId=` |
| Members | `/WorkspaceMembership/add-member?apiKey=&workspaceId=&email=` |
| Members | `/WorkspaceMembership/delete-member?apiKey=&workspaceId=&email=` |
| Profile | `/Profile/set-locale?apiKey=&locale=` |
| Profile | `/Profile/set-feature-update-channel?apiKey=&channel=` |
| Integrations | `GET /IntegrationAccount/list-all?apiKey=&workspaceId=` |
| Integrations | `GET /IntegrationAccount/list-by-integration?apiKey=&workspaceId=&integrationId=[&pipelineId=]` |
| Integrations | `/IntegrationAccount/{id}/rename`, `/IntegrationAccount/{id}/disabled`, `/IntegrationAccount/bulk-disabled` |
| Amazon auth | `GET /AmazonAuth/urls?apiKey=` (Seller Partner) |
| Amazon auth | `GET /AmazonVendorAuth/urls?apiKey=` |
| Amazon auth | `GET /AmazonAdsAuth/urls?apiKey=` |
| Amazon auth | `/AmazonAuthResponse/success` (sniffed) |
| Pipelines | `GET /PipelineIntegrationOption/v2/get?integrationId=&apiKey=` |
| Pipelines | `GET /PipelineFilterOptions/get?apiKey=&integrationTableInstanceIds=…` (repeated param) |
| Pipelines | `PUT /PipelineSetup/upsert`, `PUT /PipelineSetup/v2/upsert` |
| Pipelines | `/PipelineSetup/duplicate`, `/PipelineSetup/delete`, `/PipelineSetup/delete-all-in-spreadsheet` |
| Pipelines | `/PipelineSetup/validate-itab-params` |
| Pipelines | `GET /PipelineFreshnessCheck/get-range-last-sync-time?apiKey=&spreadsheetId=&{sheetId}=sheetId&a1NotationRange=` |
| Spreadsheet | `POST /Spreadsheet/sync-sheet-name`, `POST /Spreadsheet/add-sheet` |
| Writebacks | `POST /Spreadsheet/v3/detect-writebacks` |
| Writebacks | `POST /Spreadsheet/v2/commit-writebacks` |
| Templates | `GET /SolutionTemplate/getPredefined?apiKey=`, `POST /SolutionTemplate/usePredefined` |
| AI | `POST /AiInstructions/submit?apiKey=&workspaceId=` |
| AI | `POST /AiAgent/chat?apiKey=` |
| AI | `POST /AiAgent/chat/continue?apiKey=` |
| AI | `POST /AiAgent/save?apiKey=` |
| AI | `POST /AiAgent/clear?apiKey=` |
| AI | `POST /AiAgent/feedback?apiKey=` |
| Usage | `GET /Usage/get-linked-spreadsheets?apiKey=&workspaceId=`, `GET /Usage/get-usage-stats?apiKey=&workspaceId=` |
| Billing | `GET /BillingPlan/flat-rate`, `/BillingPlan/addons`, `/BillingPlan/workspace-context` (all `?apiKey=&workspaceId=`) |
| Billing | `/BillingAccess/v2/check`, `/BillingAccess/v2/activate-addon` |
| Billing | `POST /BillingCheckout/create-session`, `/BillingCheckout/preview-addon-adjustment`, `/BillingCheckout/apply-addon-adjustment` |
| Billing | `POST /BillingCustomerPortal/v2/create-session` |
| Announcements | `GET /announcements/ephemeral?apiKey=`, `GET /announcements/changelog?apiKey=`, `/announcements/{id}/mark-as-seen?apiKey=` |
| Affiliate | `POST /affiliate/set-referral?apiKey=` |
| Contact | `POST /contactus/post-message` |

Third-party: `https://billing.stripe.com/p/login/…` (Stripe customer portal), `https://api-eu.mixpanel.com/track`.

### 3.4 Service worker ↔ backend (realtime)

**Technology: ASP.NET Core SignalR** (Microsoft), not socket.io, not raw WS.

```js
let l = r.getSignalRHubUrl(o, s);           // https://app.hopted.com/hopted-hub?apiKey=…&workspaceId=…
let u = new n().withUrl(l).withAutomaticReconnect().configureLogging(e.Information).build();
u.keepAliveIntervalInMilliseconds = 2e4;    // 20s
u.serverTimeoutInMilliseconds     = 6e4;    // 60s
```

Hub events subscribed (`connection.on(...)`) and their relayed content-script message types:

| SignalR server event | Relayed as |
|---|---|
| `SheetDataLoadingStartedEvent` | `SHEET_DATA_LOADING_STARTED` |
| `NotifyAppUserEvent` | `NOTIFY_APP_USER` |
| `AnnouncementMarkedAsSeenEvent` | `ANNOUNCEMENT_MARKED_AS_SEEN` |
| `WorkspaceIncidentsSeenStateChangedEvent` | `WORKSPACE_INCIDENTS_SEEN_STATE_CHANGED` |
| `PipelineChangedEvent` | `PIPELINE_CHANGED` |
| `IncidentsChangedEvent` | `INCIDENTS_CHANGED` |
| `ShowToastEvent` | `SHOW_TOAST` |
| `WritebackStatusEvent` | `WRITEBACK_STATUS` |

Fan-out to tabs:
```js
async function y(e,t){
  let n = await chrome.tabs.query({url:`https://docs.google.com/spreadsheets/*`});
  if(n.length===0){ a.info(`No Google Sheets tab found to deliver ${e} SignalR payload…`); return }
  for(…) await chrome.tabs.sendMessage(id, {type:e, payload:t})
}
```
Broadcast to **all** Sheets tabs; each tab's store filters by spreadsheet/sheet id. Simple, and correct given a workspace-scoped hub.

**MV3 survival strategy for the socket** — this is the clever part:
- The connection context (`apiKey`, `workspaceId`) is mirrored into `chrome.storage.session` so a suspended-and-revived SW can `rehydrateDesiredContext()` and reconnect without a round trip to the page.
- Reconnect backoff is scheduled via `chrome.alarms.create("signalRReconnect", {when: Date.now()+delay})` when alarms are available, with a `setTimeout` fallback — because `setTimeout` does not survive SW suspension.
- A `keepAlive` alarm with `periodInMinutes: 1` fires `ensureStarted("Keep alive alarm")`, which both wakes the SW and re-asserts the connection.
- A guard logs `SignalR stop failed during context change; aborting start to avoid duplicate connections` — they explicitly defend against double connections on workspace switch.

---

## 4. Auth flow

### 4.1 Google sign-in — no `chrome.identity`

There is **no** `chrome.identity`, no `launchWebAuthFlow`, no `getAuthToken`, and no `oauth2` manifest block. Instead, from `OnboardingWelcome-DOzpPfji.js`, the content script opens a plain browser popup:

```js
function a(){
  let e = navigator.language || navigator.languages[0];
  let t = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let n = new Date().getTimezoneOffset();
  o( v.googleAuthLoginUrl(n, t, e), i(`const.hopted`), 500 )   // window.open(url, name, features)
}
```
`o()` computes a 500 × min(0.8·screenHeight, 700) window centred on the current window using `window.screenLeft/screenTop` and opens it with `window.open`. The URL is Hopted's **own** `/api/v1/GoogleAuth/login` — the OAuth dance happens entirely server-side; Google's consent screen is served through the backend's redirect. The extension never sees a Google token.

Locale, IANA timezone, and UTC offset are passed at login so the backend can set the workspace timezone and UI language from first contact. Small but nice.

### 4.2 How the token gets back into the extension — response-header sniffing

This is the mechanism to understand. Because there is no `externally_connectable`, the backend hands the extension its session token **in an HTTP response header on the OAuth callback navigation**, which the SW observes:

```js
class Ae {
  static apiKeyHeaderName = `hopted-api-key`;
  static initWebRequestOnHeadersReceivedListener(){
    chrome.webRequest.onHeadersReceived.addListener(function(t){
      if(t.responseHeaders) switch(t.type){
        case `main_frame`:
          e.trackSuccessfulGoogleOAuth(t);
          e.trackSuccessfulAmazonSpAuth(t);
          break;
        case `xmlhttprequest`:
          e.isGoogleSheetSaveUrl(t.url) || e.trackChangesInSpreadsheetSharing(t.url, t.tabId).then();
          break;
      }
    }, { urls:[ `${amazonAuthResponseSuccessUrl}*`, `${googleAuthCallbackUrl}*`,
                `${googleSharingUrl}*`, `${googleSheetsSaveUrl}*` ],
         types:[`main_frame`,`xmlhttprequest`] },
       [`responseHeaders`]);
  }
}
```

and:

```js
static trackSuccessfulGoogleOAuth(t){
  if(t.url.includes(googleAuthCallbackUrl) && t.responseHeaders!==void 0){
    for(…) if(headerName.toLowerCase() === `hopted-api-key`){
      let e = t.responseHeaders[n].value;
      c.setApiKey(e).then(()=> a.debug(`ApiKey persistently stored in a browser`));
      o.trackServiceWorkerEvent(Analytics_Event_IntegrationCompleted, {Provider:"Google"});
      setTimeout(()=> chrome.tabs.remove(t.tabId, ()=>{}), 1000);   // auto-close the popup
      De(e).then();                                                  // post affiliate referral
      return
    }
  }
}
```

The popup closes itself 1 second after the key lands — the user never has to dismiss it.

Amazon auth is the mirror image: the content script asks the SW for provider auth URLs (`GET_AMAZON_SP_AUTH_URLS` etc. → `/AmazonAuth/urls`), the SW opens a 700×800 `chrome.windows.create` popup centred via `chrome.system.display.getInfo()`, records the mapping `{tabIdWhichWasOpenedByExtension, tabIdOfContentScriptWhichOpenedTheNewTab}`, and on seeing `/AmazonAuthResponse/success` broadcasts `CLOSE_AUTH_WINDOW` to all Sheets tabs and closes the popup.

### 4.3 Token storage

**One key, `chrome.storage.local["ApiKey"]`**, wrapped in a small class:

```js
class N {
  static storageKeyName = `ApiKey`;
  static storage = new d;                        // promisified storage.local with a 4s timeout guard
  static async setApiKey(t){ await e.storage.set(e.storageKeyName, t) }
  static async getApiKey(){ try{ return await e.storage.get(e.storageKeyName) }catch{ return } }
  static async removeApiKey(){ … }
  static isApiKeyAvailable(e){ return e!=null && e!=="" }
}
```

The storage wrapper `d` is worth noting: every `get`/`set`/`remove` is promisified **with a 4000 ms timeout** (`operationTimeoutMs = 4e3`) and converts `chrome.runtime.lastError` into a thrown `Error`. They clearly hit hangs in `chrome.storage` in the wild.

`chrome.storage.session` holds the workspace id for SignalR rehydration. Nothing else is persisted.

**Login-completion propagation without a page reload** — the content script watches the same key:

```js
chrome.storage.onChanged.addListener(async function(e,t){
  for(let t in e) if(t === Je.storageKeyName){
    if(!await Je.getApiKey()){                       // signed out / key revoked
      a.purge(); n.closeNavigationSidebar();
      n.openAppFeature(n.featureRouteName.OnboardingWelcome); return
    }
    let e = We(); e.resetError();
    await ht.bootstrapApp();                         // GET /appinit/bootstrap
    await e.checkServiceAccountIsShared();
    e.spreadsheetSharedWithServiceAccount
      ? n.openAppFeature(n.featureRouteName.OnboardingCompleted)
      : n.openAppFeature(n.featureRouteName.OnboardingShareServiceAccount)
  }
})
```
So the flow is: popup → header sniff → `storage.local` write → `storage.onChanged` in every open Sheets tab → bootstrap → advance the onboarding router. Elegant, and it works across multiple open tabs simultaneously.

### 4.4 Security observations (things NOT to copy)

1. **`apiKey` is sent as a query-string parameter** on nearly every endpoint. It lands in server access logs, proxy logs, and any `Referer` leakage. It should be an `Authorization` header. (They already have a header convention — `X-Extension-Version` — so this is legacy, not ignorance.)
2. The token is a **long-lived opaque bearer key in `storage.local`**, readable by any code with extension context and never rotated in the client. No refresh-token flow.
3. `hopted-api-key` is a **response header on a `main_frame` navigation**, so it is visible to any extension with `webRequest` + host access on that domain.
4. The Google account email is scraped from `aria-label` attributes rather than obtained from the backend session.

### 4.5 Share-with-service-account verification — the clever bit

The check itself is a backend call:
```
GET /api/v1/GoogleAuth/spreadsheets-access?apiKey=…&spreadsheetId=…
```
The backend simply attempts to touch the spreadsheet as `hopted@hopted.iam.gserviceaccount.com` and returns a boolean. There is no Drive API call from the extension.

The interesting part is **when** it fires. Rather than polling, they sniff Google's own share-dialog RPC:

```js
static googleSharingUrl = `https://docs.google.com/drivesharing/_/DriveShareDialogUi/data/batchexecute`;

static async trackChangesInSpreadsheetSharing(e,t){
  if(!e.includes(googleSharingUrl)){ a.debug(`Google sharing url doesn't match with ${e}`); return }
  c.getApiKey().then(async e=>{
    e!==void 0 && chrome.tabs.get(t, async n=>{
      let i = await u.getGoogleSpreadsheetId(n.url);
      fetch(googleAuthSpreadsheetAccessUrl(e,i)).then(r=>r.json()).then(async r=>{
        await chrome.tabs.sendMessage(t, { type: SPREADSHEET_SHARING_SETTINGS_CHANGED,
                                           spreadsheetSharedWithServiceAccount: r,
                                           spreadsheetId: i })
      })
    })
  })
}
```

So: the moment the user clicks "Send"/"Share" in Google's native share dialog, Sheets fires a `batchexecute` XHR; the SW sees it, re-asks the backend, and pushes the result into the page. The onboarding screen advances **instantly and automatically** with zero polling and zero Drive permission. The `googleSheetsSaveUrl` (`https://docs.google.com/spreadsheets/d/*/save`) entry in the same filter exists purely to short-circuit that check for the very chatty autosave XHR.

The complementary on-demand path is `SPREADSHEET_SHARING_AUTH_CHECK`, called on app boot and on `storage.onChanged`.

---

## 5. Onboarding sequence

### 5.1 Routing model — URL-driven, inside Google's own URL

Routes are not a hash router or a modal stack. They are **query parameters appended to the live Google Sheets URL** via `history.pushState`:

```js
AppFeatureNavigationUrlParam       = `hotc`     // which screen
AppFeatureNavigationUrlParamPrefix = `hoip-`    // per-screen props, e.g. hoip-range=A1:C10
```

`openAppFeature(route, props)` rewrites the URL to `…/edit#gid=0?hotc=<route>&hoip-<k>=<v>` and pushes it; a `window.addEventListener("popstate", …)` calls `tryOpenComponent()`, which matches `hotc` against the route table, checks `requiredFeatureFlag`, and lazy-`import()`s the chunk. `closeAppFeature()` strips both prefixes and pushes again.

Consequences: browser Back/Forward works inside the extension UI, and **every screen is deep-linkable** — support can send a user a Sheets URL that opens a specific Hopted dialog on their own spreadsheet. This is a genuinely good idea.

Full route table (`app-navigation-DiqmjWFR.js`):

| Constant | `hotc` value |
|---|---|
| OnboardingWelcome | `welcome` |
| OnboardingShareServiceAccount | `share-spreadsheet` |
| OnboardingSocialMediaDialog | `social-follow` |
| OnboardingCompleted | `onboarding-completed` |
| Sidebar | `sidebar` |
| AppSettings | `settings` |
| AppHelp | `help` |
| AppContactUs | `contact-us` |
| AppConnectIntegration | `add-account` |
| Concierge | `concierge` |
| LinkedSpreadsheets | `all-linked-spreadsheets` |
| SolutionTemplateGallery | `solutions` |
| SolutionTemplateIntegrationAccounts | `solution-external-accounts` |
| SolutionTemplateSetupSuccess | `solution-added-successfully` |
| FeatureUnavailable | `unavailable` |
| ExtractUnstructuredData | `extract-unstructured-data` |
| AIInstructions | `ai-instructions` |
| AIInstructionsConfirmation | `ai-instructions-confirmation` |
| Agent | `agent` |
| AgentLaunch | `agent-launch` |
| PipelineCenter | `sync-center` |
| PipelineOverview | `sync-info` |
| PipelineIntegrationAccounts | `sync-external-accounts` |
| PipelineIntegrationTables | `sync-fields` |
| PipelineFilters | `sync-filters` |
| PipelineSchedule | `sync-schedule` |
| PipelineSetupSuccess | `sync-success` |
| PipelineUpgradePrompt | `pipeline-upgrade-prompt` |
| Writebacks | `writebacks` |
| WritebacksFaq | `writebacks-faq` |
| FeatureLink | `in-app-announcement` |

Note the vocabulary split: internal code says **Pipeline**, user-facing routes and copy say **sync**. Only one feature is behind a flag (`requiredFeatureFlag: FrontendFeature.Agent`, value `agent`).

### 5.2 Screen order

```
[toolbar button click]
        │
        ├─ no ApiKey ─────────────────────▶ welcome
        │                                     │  (window.open → backend Google OAuth)
        │                                     │  header sniff → storage.local write
        │                                     ▼
        │                              storage.onChanged fires
        │                                     │
        ├─ ApiKey, not shared ────────────▶ share-spreadsheet
        │                                     │  (batchexecute sniff → auto-advance)
        │                                     ▼
        ├─ ApiKey, shared ────────────────▶ onboarding-completed
                                              │
                                              ├─▶ agent-launch      (AI path, badged "recommended")
                                              ├─▶ solutions         (template gallery path)
                                              └─▶ sync-center       (manual pipeline path)

                                     social-follow  ─ optional interstitial
```

### 5.3 Screen-by-screen

**`welcome` — `OnboardingWelcome-DOzpPfji.js` (4 KB)**
A tagline plus a Google sign-in button rendered with Google's own `gsi-material-button` markup classes (so it looks like an official Google button). i18n keys present: `onboardingWelcome.tagline`, `onboardingWelcome.quickStartTitle`. Clicking fires the popup described in §4.1 and emits Mixpanel `Integration Started` with `Provider: Google`, plus the spreadsheet name and the list of sheet names scraped from the DOM.

**`share-spreadsheet` — `OnboardingShareServiceAccount-32dyji07.js` (4 KB)**
The pivotal screen. Contents:
- The service-account address rendered as a chip with a copy button. Copying uses `navigator.clipboard.writeText(...)` and flips the button into a 3-second "copied" state (`setTimeout(…,3e3)`), logging `User copied GCP service account email`.
- An illustration, `assets/onboarding-share-spreadsheet-Cykf1Jw1.png` — a stylised, de-identified crop of the top-right of a Sheets window showing the blue **Share** button with a lock icon and the account avatar, with the toolbar and a few blank grid cells beneath rendered as grey placeholder bars. It is a wayfinding graphic: "the button you need is up here."
- i18n keys: `titlePart1`, `titlePart2`, `instructions`, `copyButtonLabel`, `copiedButtonLabel`, `continueButtonLabel`, `closeButtonLabel`.
- On continue/close, the component **drives Google's own UI for the user**: it dispatches synthetic `keydown` + `keypress` Enter events at `#docs-titlebar-share-client-button`, opening the native Share dialog (`Trying to triggered keydown/keypress event on Google Sheet Share button`). The user pastes the address they just copied and clicks Send.
- Google's `batchexecute` XHR then fires, the SW sniffs it, re-checks the backend, and pushes `SPREADSHEET_SHARING_SETTINGS_CHANGED` — the screen advances by itself.

This is the highest-friction step in the product (asking a user to hand a robot editor access to their spreadsheet), and essentially all of the engineering cleverness in the extension is spent lowering that friction: copy-to-clipboard, auto-open the dialog, auto-detect completion.

**`social-follow` — `SocialMediaDialogContainer-BJtLZf1S.js`**
Optional growth interstitial. Keys: `followUsOnLinkedIn`, `followUsOnX`, `followUsOnReddit`, `skipButton`. Backed by `/Profile/set-feature-update-channel` with a channel enum `{InApp, LinkedIn, X, Reddit, Facebook}` — the choice is stored server-side as the user's preferred update channel, so it doubles as a preference capture rather than pure growth spam.

**`onboarding-completed` — `OnboardingCompletedRoute-Bzgfqywd.js` (8 KB)**
A three-way fork. Keys: `enabledMessage`, `actionChooseHow`, `aiCard.description` + `aiCard.badgeRecommended`, `templatesCard.title/description`, `customCard.title/description`, `otherWaysTitle`. The AI/agent card carries the "recommended" badge — the agent is the intended default entry path, with pre-made solutions second and the manual wizard third.

### 5.4 The toolbar-button gate

`QuickStart` (teleported into `#t-hopted-app`) runs this on click:
```js
if(!initialized)                        → openAppFeature(OnboardingWelcome,  …,"Welcome")
else if(shared)                         → openNavigationSidebar()            // "App is initialized, and sheet is shared. Opening sidebar."
else                                    → openAppFeature(OnboardingShareServiceAccount, …,"Service account sharing prompt")
if(anyError)                            → snackbar
```
It also calls `checkServiceAccountIsShared()` on mount and whenever `isInitialized` flips, and surfaces an unseen-incident count badge.

---

## 6. Feature surface inventory

Derived from the route table, chunk names, and the i18n namespace list (94 top-level namespaces).

### 6.1 Pipeline ("sync") wizard

Route order: `sync-center` → `sync-external-accounts` → `sync-fields` → `sync-filters` → `sync-schedule` → `sync-success`, with `sync-info` as the read-only overview and `pipeline-upgrade-prompt` as the paywall interstitial.

Namespaces confirm the step content: `pipelineIntegrationSelection`, `pipelineIntegrationTableDialog`, `pipelineIntegrationTableInstance`, `pipelineSelectedFields`, `pipelineFieldOptions`, `pipelineFieldProperties`, `pipelineFilterDialog` / `pipelineFilterContainer` / `pipelineFilterConditionGroup` / `pipelineFilterItem` / `pipelineFilterFactory`, `pipelineScheduleDialog`, `pipelineSettings`, `pipelineOverview`, `pipelineSetupSuccess`, `pipelineAddSheet`, `pipelineDataSourceList`, `templatedParameterOption`, `groupByFieldSelectionDialog` / `groupByChangeWarningDialog` / `groupByMisconfigurationWarningDialog`, `primarySourceChangeWarningDialog`, `pipelineSingleVsMultiple`, `pipelineMultipleInSingleSheet`, `pipelineSpreadsheetInDifferentWorkspace`.

Notable modelling details:
- A pipeline has a **primary integration table instance** plus secondary ones — the SW rejects `SETUP_PIPELINE` without `primaryIntegrationTableInstanceId`, and there is a dedicated "primary source change" warning dialog. So multi-source joins into one sheet are first-class.
- Filters are a **nested condition tree**: `FilterInsertionPoint = {ConditionGroupSet, InsideConditionGroup}`, with per-type editors for String/Number/Date/DateTime/Boolean and both `Relative` and `Absolute` date modes.
- `pipelineSingleVsMultiple` / `pipelineMultipleInSingleSheet` back a disambiguation screen when a sheet already has a sync. The two illustrations (`single-pipeline-in-sheet-B7KB-xns.png`, `multiple-pipelines-in-sheet-BmJCjF5i.png`) are near-identical stylised Sheets frames: the first ("extend current sync") shows a new blue column filling in alongside the existing green columns row-for-row; the second ("add as a separate sync") shows the blue column starting *below* where the green data ends, as an independent block. Two pictures that make an otherwise abstract data-layout choice obvious in one glance — a pattern worth stealing.
- Schedule dialog is workspace-timezone-aware (`workspaceSubheaderWithTimezone`) and there is a `refresh.fast` billing feature plus Mixpanel properties `Requested Interval Minutes` / `Allowed Min Interval Minutes` — refresh frequency is a paid axis.
- `PipelineFreshnessCheck/get-range-last-sync-time` supports a per-range "when was this last synced?" answer, surfaced by the `DocsTitlebar` teleport. In this build the `LastSyncInfo` component body returns empty — the feature appears shipped-but-disabled.

### 6.2 Calculated column / property system

Property type enum (`enums-lgCojS3C.js`):
```js
{ Virtual:`virtual`, SyncDirection:`syncDirection`, EuMarketplaceCountryCode:`euMarketplaceCountryCode`,
  ConstValue:`constant`, Formula:`formula`, ColumnsUnion:`union`,
  ConvertToValue:`convertToValue`, InitialValue:`initialValue` }
```
Field data types: `String=1, Integer=2, Decimal=3, Date=4, DateTime=5, Boolean=6`.

| Property | Meaning (from chunk + i18n keys) |
|---|---|
| `virtual` | A user-owned column the sync must not clobber — reserved space in the managed range. |
| `formula` | A spreadsheet-style expression with variable insertion (`formula.insertVariable`, `formula.placeholder`). **`PropertyFormula-F42BX8pA.js` (13 KB) contains a full hand-rolled expression parser** — the token constants `TNAME/TNUMBER/TSTRING/TPAREN/TCOMMA/TSEMICOLON/TEOF` and instruction opcodes `INUMBER/IOP1/IOP2/IOP3/IVAR/IVARNAME/IFUNCALL/IEXPR/IEXPREVAL/IMEMBER/IARRAY/IFUNDEF/IENDSTATEMENT` are the signature of an expr-eval-style compiler. Formulas are validated/evaluated client-side before being sent. |
| `constant` | A fixed literal written into every row. |
| `union` | Coalesce several source columns into one output column (`unionInsertButton`, `unionRemoveTooltip`). |
| `convertToValue` | Freeze a formula result to a static value. |
| `initialValue` | Seed value on first write only. |
| `syncDirection` | Per-column direction — enum `{None, In, Out, Delete}`. This is what makes writebacks column-scoped. |
| `euMarketplaceCountryCode` | Amazon-specific marketplace disambiguation. |

### 6.3 Writebacks (sheet → Amazon)

Two-phase, both server-executed:
1. `DETECT_WRITEBACKS` → `POST /Spreadsheet/v3/detect-writebacks` with `{workspaceId, spreadsheetGoogleId, sheetGoogleId, waitSeconds}`. The SW validates `1 ≤ waitSeconds ≤ 60`. The wait exists because the backend reads the sheet via the Sheets API and must let Google's autosave land first — the client tells the server how long to wait for the user's edits to become visible server-side.
2. User reviews a diff UI (per-cell previous vs new value, `writebacks.cell.previousValue`) and per-cell/bulk actions from enum `{send, keepLinkedValue, skip}` at granularity `{cell, row, column, selection}`.
3. `COMMIT_WRITEBACKS` → `POST /Spreadsheet/v2/commit-writebacks` with a validated `rows[]` array.
4. Progress arrives back over SignalR as `WritebackStatusEvent` → `WRITEBACK_STATUS`. Display timings are pinned: `WritebackLoadingMessageRotationMs = 2500`, `WritebackStatusVisibleMs = 300000`, `WritebackStatusFinishedVisibleMs = 10000`.

The user's current selection feeds this via `spreadsheet-utils-D0zDuykZ.js`, which normalises the Name Box value (strips a leading `Sheet!`, uppercases) and classifies it: `{Unknown, Cell, Range, NamedRange, SingleColumn, MultipleColumns, SingleRow, MultipleRows}`. Only a whitelist of A1 shapes is accepted as a writeback target (`A1`, `A1:C`, `A1:C9`, `A:C`, `1:9`).

Writebacks are metered — Mixpanel tracks `Writeback Lifetime Rows` / `Writeback Period Rows`, and there is a `writebacks_1000` addon tier id with an unlimited variant.

### 6.4 AI agent ("Solve with AI")

Chunks: `StandaloneAgentContainer` (36 KB, the largest feature chunk, with a 14 KB stylesheet), `AgentLaunchDialogContainer`, `AgentInitialPrompt`, plus `agent-prompt-context`, `agent-typed-placeholder` (animated placeholder cycling), `agent-onboarding-transition`, `agent-error-messages`, `agent-analytics`.

Interaction model (from `agent.*` i18n keys):
- Chat with history, new-chat, minimize/maximize, per-message 👍/👎 (`goodResponse`/`badResponse` → `POST /AiAgent/feedback` with `messageTimestamp` + `isFeedbackPositive`).
- The agent produces a **proposal** the user must explicitly apply (`agent.proposal.title`, `applyButton`, `revisionPlaceholder`, `sendRevision`) — a review-then-apply loop, not autonomous writes.
- Applied changes are **rate-limited** with a visible budget: `agent.applyLimit.*` (`remainingTooltip*`, `resettingTooltip`, `failedTooltip`) and `AGENT_SAVE_PENDING_DRAFTS` carries `supportsApplyLimitAutoReset`.
- Prompt context is displayed to the user before sending: current sheet, currently-edited pipeline, linked account types, or a "no linked accounts" warning.
- If the agent needs an integration that isn't connected, the prompt is parked: Mixpanel event `Agent Prompt Held For Integration Setup`.
- The agent can offer a solution template mid-conversation (`supportsSolutionTemplateOffers: true` in the chat payload).

**Transport — the most transferable detail.** MV3 service workers cannot reliably hold an SSE/streaming response, so Hopted uses a **202 + continuation-token long-poll**:

```js
async function X(e,t,n={}){
  let r = await fetch(e,{method:`POST`,headers:{"Content-Type":`application/json`,...b(),...n.headers},body:JSON.stringify(t)});
  let i = await r.text().catch(()=>``);
  if(r.status===202){
    if(!n.allowContinuationResponse) throw new q(h(),503);
    return ve(i)                                 // {status:"running", continuationToken, expiresAt}
  }
  if(!r.ok){ let e=be(i,r.status); throw new q(e.message,e.status) }
  return i ? JSON.parse(i) : {}
}
```
`AGENT_CHAT` sends `{…context, message, clientRequestId: crypto.randomUUID(), supportsSolutionTemplateOffers}` with header `X-Agent-Chat-Continuation: 1`. If the server answers `202`, the client polls `AGENT_CHAT_CONTINUE` with the `continuationToken` until a real payload arrives. The `clientRequestId` gives idempotency across retries and SW restarts.

Error handling is unusually careful: `be()`/`x()` unwrap `{detail|error|message|errors|title}` from the body, discard useless bodies (`HTTP 500` strings, HTML error pages detected by `/<(?:!doctype\s+html|html|head|body|title)\b/i`), and a `Z()` predicate maps leaked model errors (body containing `model_name`) onto a generic 503 "temporarily unavailable" — deliberately hiding LLM plumbing from users.

Adjacent AI features: `AIInstructionsDialogContainer` + confirmation (natural-language sync configuration → `POST /AiInstructions/submit`), and `ExtractUnstructuredDataDialogContainer` (illustrated by `unstructured_data_hero-kELQ60kD.png`).

### 6.5 Solution templates

`GET /SolutionTemplate/getPredefined` → gallery → choose integration accounts (`solution-external-accounts`) → `POST /SolutionTemplate/usePredefined` → success (`solution-added-successfully`, illustrated by `pre_made_solution_success-pL3PLQx5.png`). There is also a `solutionTemplateCustomSolution` namespace — a "none of these fit" escape hatch that presumably routes to the concierge.

### 6.6 Integrations

Three, all Amazon: `AmazonSp` (Seller Partner), `AmazonVc` (Vendor Central), `AmazonAds`. Each has an auth chunk and a selection chunk with an "all stores/accounts" toggle, a market editor (`editMarketsButton`), and a `connectionLost` state. Account-type enum: `{AmazonSpApiSeller, AmazonSpApiVendor}`.

### 6.7 Settings (`settings.html` options page and the in-sheet `settings` route)

`SettingsOverview`, `SettingsIntegrations`, `SettingsWorkspaceMembers`, `SettingsPlans`, `SettingsBilling`, `SettingsUsage`, `SettingsMyProfile`. Usage dimensions: `{Pipelines, Collaborators, LinkedAccounts}`. Billing period types: `{lifetimeFreePool, paidPeriod, legacyPeriod}`; pricing generations `{legacy, allInOneV1}`.

**Billing feature gates** (`BillingAccess/v2/check`) — the paywall map:
```
connectedAccount.sellerCentral, connectedAccount.vendorCentral, connectedAccount.amazonAds,
sync.creation, admin.seats, collaborators, collaborators.consent, refresh.fast, writebacks
```

### 6.8 Alerts, incidents, announcements

- **Incidents**: workspace-scoped, with unseen counts, a badge on the toolbar button, `NavigationSidebarExpandedIncidents`, `GET /workspace/get-incidents`, `POST /workspace/mark-incidents-as-seen`, and live invalidation via `IncidentsChangedEvent` / `WorkspaceIncidentsSeenStateChangedEvent` (so seen-state syncs across devices).
- **Ephemeral announcements**: keyed, TTL-cached in a Pinia store with a `startCleanupInterval` sweeper; priority-ordered `{NoLinkedAccounts:400, ActiveEditedPipeline:300, AgentEphemeralAnnouncement:200, LinkedIntegrationTypes:100}` so only the most important nudge shows. Surfaces `{gutter, key, card}`.
- **Changelog**: `GET /announcements/changelog`, with a "what's new" timeline that auto-opens the sidebar when exactly one unseen item exists.

No client-side "change history" / audit-log feature is visible; per-range freshness is the closest thing.

### 6.9 i18n

25 locales (`cs-CZ … zh-CN`) with all message catalogues **inlined into `mixpanel-wrapper-Dj6YYDii.js`** — which is why that file is 2.5 MB. Every locale is shipped to every user on every Sheets page load. This is the single worst decision in the bundle.

---

## 7. Analytics

**Mixpanel, EU residency.**

```js
class pe {
  static ProjectToken = getMixpanelProjectToken();   // a9ce65510460e9363d18ccf0e6bc81a4
  static ApiHost      = `https://api-eu.mixpanel.com`;
  static TrackUrl     = `${ApiHost}/track`;
  static initForContentScript(){
    n.init(ProjectToken, {api_host: ApiHost});
    n.register({ "Extension Version": chrome.runtime.getManifest().version })
  }
  static trackServiceWorkerEvent(…)                  // SW has no DOM → raw POST to TrackUrl
}
```
The token is plaintext in the bundle. `Extension Version` is a super-property on every event. The SW cannot run the browser SDK, so it posts to `/track` directly.

**Events**
```
Extension Installed, Extension Updated,
Integration Started, Integration Completed,
Feature Launched, Feature Requested,
Agent Opened, Agent Closed, Agent Prompt Submitted, Agent Changes Applied,
Agent Chat Cleared, Agent Prompt Held For Integration Setup,
Writebacks Dialog Opened, Writebacks Submitted,
Billing Plan CTA Clicked, Billing Plans CTA Clicked, Billing Upgrade Prompt Shown,
Changelog Shown, Changelog Opened, Changelog Dismissed,
New Badge Shown, New Badge Dismissed,
Search Performed, Text Copied, User Preferences Updated
```

**Properties** (~55). Selected: `Provider`, `Extension Version`, `Feature Name`, `Entry Point`, `Trigger`, `Triggered From`, `Surface`, `Session State`, `Spreadsheet Name`, `Sheet Names`, `Integration Schema`, `Applied Change Count`, `Pending Change Count`, `Generated Changes`, `Selected Row Count`, `Intended Row Count`, `Writeback Lifetime Rows`, `Writeback Period Rows`, `Writebacks Configured`, `Requested Interval Minutes`, `Allowed Min Interval Minutes`, `Plan ID`, `Plan Name`, `Price ID`, `Monthly Amount Cents`, `Currency`, `Pricing Generation`, `Current Add-on Quantity`, `Target Add-on Quantity`, `Required Add-on Quantity`, `Included Limit`, `Overage`, `Usage`, `Billing Feature`, `Checkout Or Update Mode`, `Solution Template ID`, `Announcement Key`, `Announcement Title`, `Query`, `Error Status`, `Success`, `Block Size`, `Prompt Type`, `Category`, `Destination`, `Feature Update Channel`.

Surface constants used as the `Feature Name` bucket: `Quick start`, `Sidebar`, `Sync`, `Pre-made solutions`.

**Privacy note:** `Spreadsheet Name` and the full `Sheet Names` array are sent to Mixpanel on sign-in. Those are user content. DragonSheets should not do this — hash them or drop them.

Separately, application logs are shipped to Hopted's own `POST /LogGateway/log` (a `LogEntry` gateway), including Vue error-handler output with component name and lifecycle hook.

---

## 8. Update / lifecycle

**`chrome.runtime.onInstalled`** (`service-worker.ts-D8yL6MRz.js`):
```js
switch(e.reason){
  case `install`:
    chrome.management.getSelf().then(async e=>{
      if(e.installType===`development`){ a.info(`Extension installed in development mode`); return }
      await we();                                              // open the success page
      o.trackServiceWorkerEvent(Analytics_Event_ExtensionInstalled)
    }); break;
  case `update`:
    chrome.management.getSelf().then(async e=>{
      a.info(`User has updated their extension`);
      e.installType!==`development` && o.trackServiceWorkerEvent(Analytics_Event_ExtensionUpdated)
    }); break;
  case `chrome_update`: … case `shared_module_update`: … default: …
}
```
The `chrome.management.getSelf().installType === "development"` check to suppress analytics and the welcome tab during local development is a small, high-value detail worth copying.

**Post-install landing** — note it *replaces the current tab* rather than opening a new one when possible:
```js
async function we(){
  let e = `${CompanyHomePage}/extension-success?utm_medium=navigation&utm_source=${browserName().toLowerCase()}`;
  let [t] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  t===void 0 ? await chrome.tabs.create({url:e}) : await chrome.tabs.update(t.id,{url:e})
}
```
`browserName()` sniffs the UA for Chrome/Firefox/Safari/IE/Edge/Opera and feeds `utm_source`.

**Uninstall URL: none.** `chrome.runtime.setUninstallURL` is never called — no churn survey. An obvious gap.

**Alarms**
| Name | Period | Purpose |
|---|---|---|
| `keepAlive` | `periodInMinutes: 1` | Wake the SW; `ensureStarted("Keep alive alarm")` re-asserts SignalR. |
| `signalRReconnect` | one-shot `when:` | Suspension-proof reconnect backoff. |

**SW init**, wrapped so one failure cannot kill the rest — worth copying verbatim as a pattern:
```js
[ $,                                       // onInstalled
  Se,                                      // runtime.onMessage router
  Te,                                      // webNavigation gid watcher
  g.initOnTabsRemoved,                     // auth popup bookkeeping
  Ae.initWebRequestOnHeadersReceivedListener,
  je,                                      // keepAlive alarm
  Me                                       // action.onClicked
].forEach(e=>{ try{ e() }catch(t){ console.error(`Error during service worker init function ${e.name||`anonymous`}:`,t); … a.error(msg, stack) } })
```

**Toolbar icon behaviour**
```js
function Me(){ chrome.action.onClicked.addListener(()=> chrome.runtime.openOptionsPage()) }
```
No popup — the browser-action icon is a shortcut to the options page. The *real* entry point is the injected in-toolbar button inside Sheets.

**Sheet switching without polling**
```js
chrome.webNavigation.onHistoryStateUpdated.addListener(e=>{
  if(e.frameId===0){
    let t = new URL(e.url).searchParams.get(`gid`);
    chrome.tabs.sendMessage(e.tabId,{type: SWITCH_BETWEEN_SHEETS, newGid: t})
  }
},{url:[{urlMatches:`https://docs.google.com/spreadsheets/`}]});
```
Sheets rewrites the URL's `gid` on every tab switch, so `onHistoryStateUpdated` is a free, zero-cost sheet-change event. The content script sets `currentSheetId` and re-renders. **Copy this.**

---

## 9. Lessons for DragonSheets

### 9.1 Imitate — the mechanisms that are genuinely good

1. **Service-account-shares-the-sheet architecture.** No Google OAuth scopes, no `googleapis.com` host permission, no token refresh in the client, no CWS OAuth verification review for restricted Sheets/Drive scopes. All heavy sheet I/O is server-side and survives the browser being closed. This one decision buys you most of the others.
2. **`onHistoryStateUpdated` for sheet switching.** Sheets mutates `?gid=` on every tab change. Free event, zero polling.
3. **Sniff Google's `drivesharing` `batchexecute` XHR to auto-detect that sharing completed.** Turns the highest-friction onboarding step into something that resolves itself while the user watches. If you'd rather not take `webRequest`, the modern equivalent is a short backoff-poll of your own `/access-check` triggered by `document.visibilitychange` — but the sniff is strictly better UX.
4. **Query-param routing pushed into Google's own URL** (`?hotc=<route>&hoip-<prop>=<value>` + `history.pushState` + `popstate`). Back/forward works, and every screen becomes a support-shareable deep link. Just namespace your params tightly and strip them on close as they do.
5. **One React root + portals into pre-created anchor `<div>`s** in the toolbar and titlebar. One store, one lifecycle, three visual surfaces.
6. **Gate the mount on your stylesheet's `load` event.** Cheap, kills the FOUC.
7. **Synthetic `keydown`+`keypress` Enter instead of `.click()`** for Google's Closure widgets, and **clone an existing Google element** (`.docs-icon`) when you need to inject something that must match Google's styling.
8. **Actively close the Gemini side panel** before opening yours, using a geometry heuristic to identify the right root rather than a brittle single selector.
9. **`storage.onChanged` as the cross-context event bus.** Popup completes auth → SW writes one key → every open tab reacts and advances its router. No reload, no port, works N-tabs-wide for free.
10. **HTTP 202 + continuation token for LLM calls.** MV3 service workers cannot hold streams. Combine with a client-generated `clientRequestId` for idempotency across SW restarts, and a `chrome.alarms`-backed reconnect/backoff since `setTimeout` dies with the worker.
11. **Mirror realtime-connection context into `chrome.storage.session`** so a revived SW can reconnect without a page round-trip, and guard against duplicate connections on context change.
12. **Derive `spreadsheetId`/`sheetId` from `sender.tab.url` in the service worker**, never from the message body.
13. **Promisified storage with an explicit timeout** and `chrome.runtime.lastError` → thrown Error.
14. **`chrome.management.getSelf().installType === "development"`** to suppress analytics and welcome tabs in dev.
15. **A Vue/React `errorHandler` that names the failing component and ships it to your backend.** When Google changes the Sheets DOM, this is your alarm bell.
16. **Wrap each SW init function in its own try/catch** so one listener failing doesn't take down messaging.
17. **Two-picture disambiguation for layout choices** (extend vs. separate). Cheap, and it removes a whole class of support tickets.
18. **Review-then-apply for the AI agent**, with a visible apply-budget. Never let the agent write to the user's spreadsheet unattended.

### 9.2 Avoid

1. **2.5 MB of inlined i18n for 25 locales shipped to every user on every page load.** Lazy-load locale chunks.
2. **38 eagerly-injected stylesheets + a 637 KB Vuetify CSS file** on every Sheets tab. Ship one small stylesheet; lazy-load the rest with the feature chunks.
3. **`apiKey` in the query string.** Use `Authorization: Bearer`. Their own `X-Extension-Version` header shows they know how.
4. **`use_dynamic_url: false` with ~130 explicitly enumerated resources**, plus a blanket `assets/*` that makes the list redundant. Use the wildcard, and turn on dynamic URLs unless you have a concrete reason not to.
5. **No `MutationObserver` and a single one-shot read of `#docs-bars`.** If Sheets renders the bar late (slow network, A/B variant), the extension silently never appears.
6. **No Shadow DOM.** Style bleeds both ways; they paper over it with `!important`.
7. **Sending `Spreadsheet Name` and the full sheet-name list to Mixpanel.** That is customer content leaving to a third party.
8. **Scraping the signed-in Google account from `<a aria-label>` containing `@`.** Locale-fragile; get it from your own session instead.
9. **No `setUninstallURL`.** Free churn signal, left on the table.
10. **No drag-to-resize on the panel.** Fixed `40rem` dialogs on a 1280px laptop next to a spreadsheet is cramped.
11. **A dead `offscreen/*` entry in web_accessible_resources** with no `offscreen` permission. Keep the manifest honest.

### 9.3 Minimal permission set for DragonSheets

If you adopt the service-account model:

```jsonc
"permissions": ["storage", "alarms", "webNavigation"],
"host_permissions": ["https://api.dragonsheets.<tld>/*", "https://docs.google.com/*"],
"content_scripts": [{ "matches": ["https://docs.google.com/spreadsheets/d/*/edit*"], "run_at": "document_idle" }]
```

Per-permission reasoning:
- `storage` — session token + cached bootstrap. Required.
- `alarms` — MV3 SW keepalive and reconnect backoff. Required if you use a WebSocket.
- `webNavigation` — the free gid-change event. Worth it; you can drop it and poll `location.hash` from the content script instead, at the cost of a timer.
- `tabs` — **avoid.** You only need it to broadcast to other Sheets tabs. Alternative: have each content script open a `chrome.runtime.connect` port; the SW pushes down the ports it already has, and `sender.tab` gives you the URL without the permission.
- `webRequest` — **avoid** if you can. Deliver the session token via `externally_connectable` from your own web app (`{"matches":["https://*.dragonsheets.<tld>/*"]}`) and `chrome.runtime.sendMessage(EXT_ID, {token})`. That is the intended MV3 path, it is far easier to justify in CWS review, and it removes an entire permission. Detect share-completion by polling your `/access-check` on `visibilitychange` + a short backoff.
- `cookies` — **avoid.** Do affiliate attribution server-side on the web app before the extension ever runs.
- `system.display` — **avoid.** Centre popups with `window.screenX/screenY/innerWidth`, as their own `OnboardingWelcome` code already does for the Google popup.
- `scripting` — not needed; the declarative content script suffices.
- `identity` — not needed under the service-account model.

That is 3 permissions vs. their 7, with the same capability set.

### 9.4 Fragility register (Sheets DOM coupling)

Their entire surface depends on these Google-owned identifiers. Ranked by blast radius:

| Identifier | Used for | If it changes |
|---|---|---|
| `#docs-bars` | app root anchor | **Total failure** — nothing renders, silently |
| `#docs-toolbar` | toolbar button anchor | No entry point |
| `#t-name-box` | reading the user's selection | Writebacks and range-scoped features break |
| `#docs-presence-container` | titlebar status anchor | Status chip vanishes (caught by try/catch) |
| `#docs-titlebar-share-client-button` | auto-opening the Share dialog | Onboarding friction spikes |
| `#docs-title-input-label-inner` | spreadsheet name | Falls back to `document.title` — handled |
| `.docs-sheet-tab` / `.docs-sheet-tab-name` | sheet enumeration, switching, logo badges | Sheet list and tab decoration break |
| `.docs-sheet-add-button` | programmatic add-sheet | Feature breaks (logs an error) |
| `.docs-icon`, `.goog-inline-block` | style inheritance for injected nodes | Cosmetic drift |
| `.appsElementsSidekickRoot.docsSidekickSideSheetRoot`, `#docs-sidekick-button-container` | Gemini panel suppression | Panel collision |
| `drivesharing/_/DriveShareDialogUi/data/batchexecute` | share-completion detection | Onboarding stalls, no auto-advance |
| `spreadsheets/d/*/save` | autosave filter | Redundant access-checks fire |
| `<a aria-label>` containing `@` | Google account email | Wrong/absent email |

**Hardening DragonSheets should add on top of their design:**
1. **Retry + `MutationObserver` for the root anchor.** Try immediately; if absent, observe `document.body` (`childList, subtree`) with a 30 s cap, and fall back to a fixed-position container appended to `<body>` if the anchor never appears. Never silently no-op.
2. **Selector fallback chains, not single selectors.** For each of the above, define an ordered list of candidates plus a shape predicate (bounding box, role, ancestor). Their Gemini-root heuristic is the right idea; generalise it.
3. **Remote-configurable selector map.** Ship the selector table in the `/bootstrap` response with a bundled default. When Google ships a change you fix it server-side in minutes instead of waiting on a CWS review cycle. Hopted centralises its constants in one class but hardcodes them — they must ship a new version for any Sheets change.
4. **Telemetry on every selector miss**, with the version and the missing key, wired to an alert. Their per-component Vue `errorHandler` is the half-measure; a per-selector counter is the real one.
5. **Shadow DOM for the panel**, with Google's own CSS explicitly *not* inherited. Costs some work with component libraries; buys immunity from `goog-*` collisions.
6. **A synthetic canary** — a scheduled headless run that opens a real Sheet with the extension and asserts each anchor resolves. Google ships Sheets changes continuously; find out before your users do.
7. **Prefer URL/state over DOM wherever possible.** `gid` from the URL, spreadsheet id from the URL, everything else from your own backend. Only the Name Box genuinely has no non-DOM equivalent — and even that can be replaced by asking the user to confirm a range in your own UI.

### 9.5 Product observations worth noting

- The whole product is built around lowering the cost of one scary ask ("share this spreadsheet with a robot"). Every clever engineering trick in the bundle serves that step. Whatever the equivalent ask is for DragonSheets, it deserves the same disproportionate investment.
- They renamed "pipeline" to "sync" for users but kept "pipeline" in code. Pick one and keep the codebase honest.
- The AI agent is the *recommended* onboarding path, ahead of templates and the manual wizard. Where a competitor puts the AI entry point tells you where they think activation comes from.
- Feature gating (`BillingAccess/v2/check`) is checked from the client but enforced server-side; the client only decides whether to show an upgrade prompt. Correct split.
- Refresh interval is a paid axis (`refresh.fast`), separate from row volume and seat count.
