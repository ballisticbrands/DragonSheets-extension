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
// click legitimately fails. Fail loudly here rather than let that read as a
// regression (it did, briefly, on 2026-08-11).
{
  const sw = fs.readFileSync(new URL('../../dist/assets/service-worker.js', import.meta.url), 'utf8');
  if (sw.includes('launchWebAuthFlow')) {
    console.error(
      'dist/ is a REAL-mode build (launchWebAuthFlow is bundled).\n' +
      'This smoke test needs the mock build:  npm run build\n'
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
fs.writeFileSync('deep-report.json',JSON.stringify({trail,errors},null,2));
console.log(JSON.stringify({trail,errors},null,2));
await ctx.close();
