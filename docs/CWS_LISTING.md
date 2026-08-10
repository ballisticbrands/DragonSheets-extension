# Chrome Web Store listing — DragonSheets

Everything needed to fill the Web Store submission form, written out so it can be pasted
field-by-field. Sections map to the developer-console form.

> **Publish UNLISTED for v0.1.0.** The extension currently runs against a mock backend: the
> UI is real, the Amazon data is not. An unlisted listing gives us a **stable extension ID**
> — which the Google OAuth redirect URI, the attribution bridge, and end-to-end testing all
> need — without a public listing that overstates what the product does. Flip to Public when
> the backend actually syncs (plan Phase 8).

---

## Store listing

**Name** (45 char max)
```
DragonSheets: Amazon Data for Google Sheets
```

**Summary** (132 char max)
```
Amazon Seller Central and Ads data, live in Google Sheets. Scheduled syncs, PPC reports, and an AI that builds them for you.
```

**Category:** Workflow & Planning
**Language:** English (United States)

**Description**
```
DragonSheets brings your Amazon Seller Central and Amazon Ads data straight into Google
Sheets — and keeps it fresh on a schedule you choose.

Stop exporting CSVs. Open a spreadsheet, pick the reports and columns you want, set a
refresh interval, and DragonSheets keeps that sheet up to date.

WHAT YOU CAN DO

• Live data syncs — choose from Seller Central and Amazon Ads reports, pick exactly the
  columns you need, and blend multiple reports into one table joined by ASIN, SKU or date.

• Scheduled refresh — every 15 minutes, hourly, daily, weekly, or on demand. Refreshes are
  non-destructive: your own formatting, formulas and extra columns are preserved.

• Ask AI — describe the report you want in plain language and the assistant assembles it,
  proposes the configuration for your review, and builds it once you approve.

• Ready-made templates — P&L by SKU, TACOS dashboard, restock planner, search-term
  explorer, returns monitor, and inventory health.

• Calculated columns — build your own metrics from the fields you have, with a formula
  editor and live preview.

HOW IT WORKS

1. Add DragonSheets to Chrome.
2. Open any Google Sheet — DragonSheets appears in the toolbar.
3. Sign in with Google, share that one spreadsheet with us, and connect your Amazon account.

Setup takes a couple of minutes and needs no code.

BUILT ON OFFICIAL AMAZON APIS

DragonSheets reads your data through Amazon's official Selling Partner and Advertising
APIs. It never scrapes Seller Central and never asks for your Amazon password.

ACCESS LIMITED TO ONE SPREADSHEET

DragonSheets does not request access to your Google Drive. You share a single spreadsheet
with our service account, and that is the only file we can read or write.
```

---

## Privacy practices tab — fill EVERY box below

> These are console form fields. Having them written here does **not** fill them in — the
> submit button stays blocked until each box below has text in it. Work top to bottom; the
> headings match the form's own labels.

### 1. Single purpose
```
DragonSheets imports a user's Amazon Seller Central and Amazon Advertising data into their Google Sheets spreadsheet and keeps it refreshed on a schedule.
```

### 2. Permission justifications — one box per permission

**`storage`**
```
Stores the user's sign-in session, their sync configurations, and onboarding progress locally in the browser, so the extension keeps working across spreadsheet tabs and browser restarts.
```

**`alarms`**
```
Schedules two periodic background tasks: refreshing the extension's configuration file, and retrying analytics events that failed while the browser was offline. Manifest V3 terminates service workers frequently, so setTimeout/setInterval do not survive; chrome.alarms is the only reliable option.
```

**`identity`**
```
Used only for "Sign in with Google" via chrome.identity.launchWebAuthFlow, requesting just the openid, email and profile scopes to create the user's DragonSheets account. No Google Drive or Google Sheets scopes are requested.
```

### 3. Host permission justification — ONE box for all three hosts

⚠️ The console asks for a single host-permission justification, not one per host. Paste this
whole paragraph:
```
The extension requests three hosts, each required for core functionality. https://docs.google.com/* is required because the extension's entire user interface is a panel injected into the Google Sheets page; without it there is no product. https://api.getdragonbot.com/* is our API server, which stores the user's Amazon connection and returns the report data they asked to import. https://*.getdragonsheets.com/* is our own domain, used to fetch the extension's configuration file and to receive install attribution from our post-install page. No other hosts are accessed.
```

### 4. Remote code use

Select **"No, I am not using remote code."** Justification:
```
All JavaScript is bundled inside the extension package. The extension loads no external scripts, evaluates no strings as code, and its content security policy permits scripts only from the package itself.
```

### 5. Data usage — tick exactly these

| Data type | Tick? |
|---|---|
| Personally identifiable information (name, email) | ✅ |
| Authentication information | ✅ |
| Financial and payment information | ✅ |
| Health / personal communications / location / web history / user activity | ❌ leave unticked |

Then tick **all three certifications** (all are true for us):
- I do not sell or transfer user data to third parties, outside of approved use cases
- I do not use or transfer user data for purposes unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### 6. Privacy policy URL
```
https://go.getdragonsheets.com/privacy/
```

---

## Account Settings tab — two things that block publishing

These are **publisher-level**, not item-level, which is why they read oddly next to the item
errors. Developer console → **Settings** (left sidebar, under the account, not the item):

1. **Contact email** — enter `owner@ballisticbrands.co`.
2. **Verify it** — Google sends a confirmation mail; click the link. Publishing stays blocked
   until it shows as verified, and the mail sometimes lands in spam.

## Graphical assets — ✅ READY (2026-08-10)

Captured from the real extension running in a real Google Sheet, then resized to the exact
1280×800 the store requires. In `store-assets/`, upload in this order:

| # | File | Shows |
|---|---|---|
| **1** | `screenshot-1-ai-agent.png` | **PRIMARY.** Sidebar's "Solve with AI" beside a populated sheet, with a real prompt typed in. The one-frame explanation of the product. |
| 2 | `screenshot-2-home.png` | Sidebar home: Connect Amazon, AI Agent, Templates, Syncs, Settings |
| 3 | `screenshot-3-connected-accounts.png` | Settings → Seller Central + Amazon Ads both connected |
| 4 | `screenshot-4-templates.png` | Template gallery — P&L by SKU |
| 5 | `screenshot-5-templates-ppc.png` | Template gallery — search-term explorer / returns monitor |

Store icon: `public/icons/icon128.png` (128×128) ✅

Screenshots 4 and 5 are sidebar-only captures, centre-padded onto the 1280×800 canvas with a
light neutral (#F2F5F2). 1–3 are full-window and needed only a resize.

### ⚠️ Read before uploading: the "Mock mode" footer

Screenshots 1–3 include the sidebar's footer line: *"Mock mode — no data leaves this browser
yet."* That is **deliberately left in**. The extension genuinely is running on mock data at
v0.1.0, so a listing whose screenshots hid that line would imply live Amazon syncing we do
not yet do. Leaving it is both the honest choice and consistent with shipping **unlisted**.

**Retake screenshots 1–3 before flipping the listing to Public** — by then the footer will be
gone on its own, because the backend will be real.

Optional and not blocking: a 440×280 small promo tile (improves placement in store browsing)
and a 1400×560 marquee tile (only needed if Google ever features us). Neither is required to
publish.

## Submission checklist

1. [x] CWS developer account registered ($5 one-time) — done 2026-08-10
2. [ ] `npm run zip` → `release/dragonsheets-extension-v0.1.0.zip`
3. [ ] Upload zip, set **Visibility: Unlisted**
4. [ ] Paste name / summary / description / category from above
5. [x] Screenshots ready — upload all five from `store-assets/` in the numbered order, plus the 128px icon
6. [ ] Fill single purpose + permission justifications + data declarations above
7. [ ] Privacy policy URL
8. [ ] Submit; expect days, not hours, for first review
9. [ ] **After approval:** copy the extension ID into
   - `site/installed/index.html` → `DRAGONSHEETS_EXTENSION_ID`
   - the shared OAuth client's redirect URIs → `https://<id>.chromiumapp.org/oauth2`
   - `DragonSheets-LP/src/lib/config.js` → `CWS_URL`

## Automated publishing (later)

`.github/workflows/release.yml` has the upload step written but commented out. To enable,
add repo secrets `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
`CWS_REFRESH_TOKEN` (from the Chrome Web Store API OAuth flow) and uncomment. Not worth
doing until there's a second release to publish.
