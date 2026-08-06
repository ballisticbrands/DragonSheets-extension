/**
 * Mock Amazon consent popup (web-accessible extension page).
 *
 * Simulates the server-side LWA consent flow: shows a brief "redirecting to
 * Amazon" state, then auto-succeeds and posts the SAME message shape the real
 * flow's callback page will post ({type: "dragonbot-oauth-result", provider,
 * status}) back to window.opener, then closes itself. Phase 8 replaces the
 * popup URL with the consent URL from POST /v1/connect/.../start — the
 * sidebar-side listener (ConnectAmazon.tsx) does not change.
 */
import "../app/styles.css";

type Provider = "amazon-selling-partner" | "amazon-ads";

const params = new URLSearchParams(location.search);
const provider = (params.get("provider") ?? "amazon-selling-partner") as Provider;
const label = provider === "amazon-ads" ? "Amazon Ads" : "Seller Central";

const root = document.getElementById("root")!;
root.innerHTML = `
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-8 font-sans text-ink">
    <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-forest text-[14px] font-bold text-white">DS</div>
    <h1 class="text-[17px] font-bold tracking-tight">Connecting ${label}</h1>
    <p id="status" class="max-w-[300px] text-center text-[13px] leading-relaxed text-ink/60">
      Redirecting to Amazon to approve access…
    </p>
    <div id="spinner" class="h-6 w-6 animate-spin rounded-full border-2 border-forest/30 border-t-forest"></div>
    <p class="text-[11px] text-ink/40">Mock mode — no real Amazon call is made.</p>
  </div>
`;

const statusEl = document.getElementById("status")!;
const spinnerEl = document.getElementById("spinner")!;

setTimeout(() => {
  statusEl.textContent = "Access approved. You can close this window.";
  spinnerEl.outerHTML =
    '<div class="flex h-6 w-6 items-center justify-center rounded-full bg-lime/30 text-[13px]">✓</div>';
  try {
    // targetOrigin "*" is acceptable here: the payload carries no secrets and
    // the mock popup can only have been opened from the sidebar. The REAL
    // callback page must post to the exact opener origin instead.
    window.opener?.postMessage(
      { type: "dragonbot-oauth-result", provider, status: "success" },
      "*"
    );
  } catch {
    // opener gone — user can just close the window.
  }
  setTimeout(() => window.close(), 900);
}, 1400);
