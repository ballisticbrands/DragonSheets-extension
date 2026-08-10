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

## Privacy practices (the section that stalls reviews)

**Single purpose** (one sentence, must be genuinely singular)
```
DragonSheets imports a user's Amazon Seller Central and Amazon Advertising data into their
Google Sheets spreadsheet and keeps it refreshed on a schedule.
```

**Permission justifications** — one per requested permission. Keep these literal; reviewers
compare them against actual code.

| Permission | Justification to paste |
|---|---|
| `storage` | Stores the user's sign-in session, their sync configurations, and UI state (such as which onboarding steps are complete) locally in the browser so the extension works across spreadsheet tabs and browser restarts. |
| `alarms` | Schedules two periodic background tasks: refreshing the extension's configuration file and retrying analytics events that failed while the browser was offline. Service workers are terminated frequently in Manifest V3, so timers are not a viable alternative. |
| `identity` | Used solely for "Sign in with Google" via `chrome.identity.launchWebAuthFlow`, requesting only the `openid`, `email` and `profile` scopes to create the user's DragonSheets account. No Google Drive or Sheets scopes are requested. |
| Host: `https://*.getdragonsheets.com/*` | The extension's own backend and static site. Used to fetch configuration and to receive install attribution from our post-install page. |
| Host: `https://api.getdragonbot.com/*` | Our API server, which holds the user's Amazon connection and returns their report data. |
| Host: `https://docs.google.com/*` | Required to inject the DragonSheets panel into the Google Sheets interface, which is the extension's entire user interface. |
| Remote code | **No.** All code ships inside the package. The extension loads no remote scripts, and its content security policy forbids them. |

**Data usage declarations** — tick these and no others:

| Data type | Collected | Why |
|---|---|---|
| Personally identifiable information | ✅ | Email address and name from Google sign-in, used to create and identify the account. |
| Authentication information | ✅ | OAuth tokens for the user's Google and Amazon connections, used only to access the data they explicitly connect. |
| Financial and payment information | ✅ | Amazon sales, fees and advertising spend — the business data the user asks us to import. |
| Health, personal communications, location, web history, user activity | ❌ | Not collected. |

**Three required certifications** — all true for us, tick all three:
- Not being sold to third parties
- Not being used for purposes unrelated to the item's single purpose
- Not being used to determine creditworthiness or for lending

**Privacy policy URL**
```
https://go.getdragonsheets.com/privacy/
```

---

## Graphical assets

⚠️ **These are the one thing that cannot be produced until the extension has been run in a
browser** (see DRAGONSHEETS_USER_TASKS.md Task 8). Every screenshot must show real UI.

| Asset | Spec | Status |
|---|---|---|
| Store icon | 128×128 PNG | ✅ in repo (`public/icons/icon128.png`) |
| Screenshots | 1280×800 (preferred) or 640×400 — **1 required, 5 allowed** | ❌ needs a browser run |
| Small promo tile | 440×280 PNG | ❌ optional, but listings with one convert better |
| Marquee promo tile | 1400×560 PNG | ❌ optional, only needed for featuring |

**Suggested five screenshots**, in this order (mirrors the funnel):
1. The sidebar open beside a populated sheet — the "what you get" shot, most important.
2. The sync wizard on the report-picker step.
3. The AI agent mid-conversation with a proposal card.
4. The template gallery.
5. The connect-Amazon screen (trust signal).

Capture at exactly 1280×800 with the browser zoomed so the sidebar fills a meaningful share
of the frame. Once the extension runs, I can automate these with Playwright.

---

## Submission checklist

1. [ ] CWS developer account registered ($5 one-time), publisher email verified
2. [ ] `npm run zip` → `release/dragonsheets-extension-v0.1.0.zip`
3. [ ] Upload zip, set **Visibility: Unlisted**
4. [ ] Paste name / summary / description / category from above
5. [ ] Upload icon + at least one screenshot
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
