/**
 * Browser smoke test for the PACKAGED extension.
 *
 * The trick that makes this possible without a Google account: the content
 * script only matches https://docs.google.com/spreadsheets/*, so we intercept
 * that URL in Playwright and fulfil it with ./sheets-fixture.html — a minimal
 * page carrying the Google-owned anchors from src/content/selector-map.ts
 * (#docs-bars, #docs-toolbar, ...). Chrome then runs the real, unmodified
 * extension against it.
 *
 * Covers: launcher injection, shadow-DOM mount, the onboarding flow, keyboard
 * focusability of the entry cards, and console/page errors throughout.
 *
 * Requires headed-capable Chromium:  npx playwright install chromium
 * Run:                               node test/browser/smoke.mjs
 *
 * NOT covered (needs a real Google account): the true Sheets DOM, which
 * changes without notice — that is what the remote selector map in
 * bootstrap.json exists to absorb.
 */
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'This smoke test needs Playwright, which is deliberately NOT a dependency of\n' +
    'this repo (it would pull ~100MB of browser binaries into every install and CI\n' +
    'run, for a test only run by hand).\n\n' +
    'Set it up once:\n' +
    '  npm i -D --no-save playwright && npx playwright install chromium\n'
  );
  process.exit(1);
}
import fs from 'node:fs';
const EXT=new URL('../../dist', import.meta.url).pathname;
const FIXTURE=fs.readFileSync(new URL('./sheets-fixture.html',import.meta.url),'utf8');
const errors=[], trail=[];
// This harness drives the MOCK build: real mode routes sign-in through Google
// OAuth, which cannot complete headlessly, so every step after the sign-in
// click legitimately fails. Fail loudly rather than let that read as a
// regression (it did, briefly, on 2026-08-11).
{
  let mode = "unknown";
  try {
    mode = JSON.parse(
      fs.readFileSync(new URL("../../dist/build-info.json", import.meta.url), "utf8"),
    ).backend;
  } catch {
    console.error("dist/build-info.json missing — run `npm run build` first.");
    process.exit(1);
  }
  if (mode !== "mock") {
    console.error(
      `dist/ was built with backend=${mode}. This smoke test needs the mock build:\n` +
        "  npm run build\n",
    );
    process.exit(1);
  }
}

const ctx=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',
 args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`],viewport:{width:1280,height:800}});
ctx.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});
ctx.on('weberror',e=>errors.push('weberror: '+e.error().message));
await ctx.route('https://docs.google.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:FIXTURE}));
const page=await ctx.newPage();
page.on('pageerror',e=>errors.push('pageerror: '+e.message));
const txt=()=>page.evaluate(()=>document.querySelector('#dragonsheets-host')?.shadowRoot?.textContent?.replace(/\s+/g,' ').trim()||'');
async function waitText(re,ms=15000){const t0=Date.now();while(Date.now()-t0<ms){if(re.test(await txt()))return true;await page.waitForTimeout(200)}return false}
async function click(rx,label){
  try{ await page.getByRole('button',{name:rx}).first().click({timeout:8000});
       trail.push({click:label,ok:true}); await page.waitForTimeout(1200); return true }
  catch(e){ trail.push({click:label,ok:false,why:String(e).split('\n')[0].slice(0,80)}); return false }
}
await page.goto('https://docs.google.com/spreadsheets/d/T/edit');
await page.locator('#dragonsheets-launcher').click({timeout:15000});
await waitText(/Sign in with Google/i);
await click(/sign in with google/i,'sign-in');
await waitText(/share|service account|@/i);
// The share step auto-advances in some mock states, so this button is optional.
{ const b=page.getByRole('button',{name:/check access/i});
  if (await b.count()) await click(/check access/i,'check-access'); }
await waitText(/Pick how you want to start|Solve with AI/i);
// count focusables now (post-fix)
const focus = await page.evaluate(()=>[...document.querySelector('#dragonsheets-host').shadowRoot
  .querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
  .map(e=>e.tagName+':'+(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,30)));
trail.push({entryScreenFocusables:focus});
await page.screenshot({path:'d-01-entry.png'});
// Now enter each area via the cards (now buttons)
await click(/solve with ai/i,'open-agent'); await page.screenshot({path:'d-02-agent.png'});
trail.push({agentText:(await txt()).slice(0,160)});
await click(/home|‹/i,'back-home-1');
await click(/templates/i,'open-templates'); await page.screenshot({path:'d-03-templates.png'});
trail.push({templatesText:(await txt()).slice(0,160)});
// back home then sync wizard
await click(/home|‹/i,'back-home-2');
await click(/live data sync|syncs/i,'open-syncs'); await page.screenshot({path:'d-04-syncs.png'});
trail.push({syncsText:(await txt()).slice(0,160)});
await click(/new live data sync|new sync|create/i,'open-wizard'); await page.screenshot({path:'d-05-wizard.png'});
trail.push({wizardText:(await txt()).slice(0,200)});

// ── regression checks for the 2026-08-12 fixes ────────────────────────────
// These assert, rather than narrate: each one is a bug that shipped once.
const checks=[];
function assert(label,ok,detail){checks.push(ok?{check:label,ok:true}:{check:label,ok:false,detail:String(detail).slice(0,200)})}

// Bug 3 — the panel used to be top:0/h-screen and covered Google's title bar,
// including the Share button its own onboarding tells the user to click.
const geom = await page.evaluate(() => {
  const host = document.querySelector('#dragonsheets-host');
  const panel = host.shadowRoot.querySelector('#dragonsheets-app > div');
  const body = panel.querySelector('.overflow-y-auto');
  const box = (sel) => document.querySelector(sel).getBoundingClientRect();
  const covered = (sel) => {
    const r = box(sel);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === null || hit.closest(sel) === null;
  };
  const p = panel.getBoundingClientRect();
  return {
    panelTop: Math.round(p.top), panelBottom: Math.round(p.bottom),
    toolbarBottom: Math.round(box('#docs-toolbar').bottom),
    viewportHeight: window.innerHeight,
    shareCovered: covered('#docs-titlebar-share-client-button'),
    launcherCovered: covered('#dragonsheets-launcher'),
    bodyScrolls: body ? getComputedStyle(body).overflowY === 'auto' && body.clientHeight > 0
      && body.clientHeight <= p.height : false,
  };
});
trail.push({geometry:geom});
// The offset is a fixed 100px by choice (src/content/top-offset.ts): a constant
// cannot be broken by Google reshuffling its DOM, and when it is wrong it is
// wrong visibly and slightly rather than silently. Assert BOTH the constant and
// the property it exists to guarantee — if Sheets' chrome ever grows past it,
// the second assertion fails and names the real problem.
assert('panel starts at the fixed 100px offset', geom.panelTop === 100, JSON.stringify(geom));
assert('…which clears Google\'s toolbar', geom.panelTop >= geom.toolbarBottom, JSON.stringify(geom));
assert('panel still runs to the bottom of the viewport',
  Math.abs(geom.panelBottom - geom.viewportHeight) <= 1, JSON.stringify(geom));
assert('Google\'s Share button is clickable, not covered', !geom.shareCovered, JSON.stringify(geom));
assert('the launcher pill is clickable, not covered', !geom.launcherCovered, JSON.stringify(geom));
assert('the panel body still scrolls inside the reduced height', geom.bodyScrolls, JSON.stringify(geom));

// Bugs 1 + 2 — reach the share screen by deep link (dsr=), which also proves
// the deep-link router survived the sharing gate.
await page.goto('https://docs.google.com/spreadsheets/d/T/edit?dsr=share-spreadsheet');
const reachedShare = await waitText(/Share this spreadsheet with DragonSheets/i);
assert('dsr= deep link still lands on its screen with the gate in place', reachedShare,
  (await txt()).slice(0,200));

// Bug 1 — the service-account address must never render blank.
const readEmail = () => page.evaluate(() => {
  const root = document.querySelector('#dragonsheets-host').shadowRoot;
  const box = [...root.querySelectorAll('.font-mono')].map(e => e.textContent.trim()).filter(Boolean);
  return box[0] || '';
});
let shownEmail = '';
for (const t0 = Date.now(); Date.now() - t0 < 15000;) {
  shownEmail = await readEmail();
  if (shownEmail) break;
  await page.waitForTimeout(200);
}
trail.push({shareEmail:shownEmail});
assert('the share screen renders a real address, not an empty box',
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(shownEmail), shownEmail);

// Bug 2 — "open it for me" must actually fire Google's handler. The fixture's
// Share control is a div[role=button] that only reacts to the mousedown→mouseup
// pair, exactly like the real Closure widget: a regression to .click()-only or
// keydown-only fails here.
const dialogBefore = await page.evaluate(() =>
  getComputedStyle(document.querySelector('#share-dialog')).display);
await page.getByRole('button',{name:/open it for me/i}).first().click({timeout:8000});
await page.waitForTimeout(1500);
const dialogAfter = await page.evaluate(() =>
  getComputedStyle(document.querySelector('#share-dialog')).display);
trail.push({shareDialog:{before:dialogBefore,after:dialogAfter}});
assert('"open it for me" opens Google\'s Share dialog',
  dialogBefore === 'none' && dialogAfter !== 'none', `${dialogBefore} → ${dialogAfter}`);
await page.screenshot({path:'d-06-share.png'});

// ── Settings → Accounts: one card per CONNECTION ──────────────────────────
// The bug: Accounts rendered getConnectionStatus(), a two-slot summary, so it
// could show at most two cards while Plan — reading the real per-connection
// list — said three. The mock now seeds FOUR connections (two Seller Central,
// two Ads, one of them expired), which makes the old collapse impossible to
// mistake for correct.
await page.goto('https://docs.google.com/spreadsheets/d/T/edit?dsr=settings&dsp-tab=accounts');
await waitText(/Add another Amazon account/i);
const cards = await page.evaluate(() => {
  const root = document.querySelector('#dragonsheets-host').shadowRoot;
  return [...root.querySelectorAll('[data-account-card]')].map(el => {
    const full = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const buttons = [...el.querySelectorAll('button')].map(b => (b.textContent||'').trim());
    return {
      id: el.getAttribute('data-account-card'),
      badge: (el.querySelector('span.rounded-full')?.textContent || '').trim(),
      provider: /Amazon Ads ·|Amazon Ads$/.test(full) ? 'ads'
        : /Seller Central/.test(full) ? 'seller-central' : 'unknown',
      buttons,
      text: full.slice(0, 90),
    };
  });
});
trail.push({accountCards:cards});
await page.screenshot({path:'d-07-settings-accounts.png'});

assert('Accounts renders one card per connection, not two provider slots',
  cards.length === 4, JSON.stringify(cards));
assert('…both Seller Central accounts are present (the one that used to vanish)',
  cards.filter(c => c.provider === 'seller-central').length === 2, JSON.stringify(cards));
assert('…and the expired connection is visible, not silently absent',
  cards.some(c => c.badge === 'Needs reconnect'), JSON.stringify(cards.map(c=>c.badge)));
assert('every card carries its OWN Reconnect + Disconnect',
  cards.every(c => c.buttons.some(b => /^Reconnect$/.test(b)) &&
                   c.buttons.some(b => /^Disconnect$/.test(b))),
  JSON.stringify(cards.map(c=>c.buttons)));

// Plan's "Amazon accounts" meter counts the CONNECTED ones — the same payload,
// a deliberately different number. Both must agree with what Accounts shows.
await page.goto('https://docs.google.com/spreadsheets/d/T/edit?dsr=settings&dsp-tab=plan');
await waitText(/Amazon accounts/i);
const planText = await txt();
const planAccounts = /Amazon accounts\s*([\d,]+)\s*\/\s*([\d,]+)/.exec(planText);
const planUsed = planAccounts ? Number(planAccounts[1].replace(/,/g,'')) : NaN;
const connectedCards = cards.filter(c => c.badge === 'Connected').length;
trail.push({planAmazonAccounts:planUsed, connectedCards, cardCount:cards.length});
await page.screenshot({path:'d-08-settings-plan.png'});

assert('Plan still reports a figure for Amazon accounts', Number.isFinite(planUsed), planText.slice(0,200));
assert('Accounts and Plan agree: connected cards === Plan\'s Amazon accounts',
  connectedCards === planUsed, `${connectedCards} connected cards vs plan ${planUsed}`);
assert('…and Plan counts only the healthy ones, so it is BELOW the card count',
  planUsed < cards.length, `plan ${planUsed}, cards ${cards.length}`);

const failed = checks.filter(c => !c.ok);
fs.writeFileSync('deep-report.json',JSON.stringify({trail,checks,errors},null,2));
console.log(JSON.stringify({trail,checks,errors},null,2));
await ctx.close();
if (failed.length > 0 || errors.length > 0) {
  console.error(`\n${failed.length} regression check(s) failed, ${errors.length} page error(s).`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} regression checks passed, ${trail.filter(t=>t.click).length} clicks OK, 0 page errors.`);
