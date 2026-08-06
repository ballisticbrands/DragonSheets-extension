/**
 * Onboarding step 2 — share the spreadsheet with the service account
 * (route: share-spreadsheet). The pivotal, highest-friction screen (teardown
 * §5.3): copy-to-clipboard, auto-open Google's Share dialog, check access.
 */
import { useEffect, useState } from "react";
import { getBackend } from "../../backend";
import { logDiag } from "../../lib/diagnostics";
import { Button } from "../../ui/Button";
import { CopyButton } from "../../ui/CopyButton";
import { Spinner } from "../../ui/Spinner";
import type { AppContext } from "../App";

export function ShareSpreadsheet({ ctx }: { ctx: AppContext }) {
  const [email, setEmail] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void getBackend().getServiceAccountEmail().then(setEmail);
  }, []);

  /** Drive Google's own UI for the user: synthetic Enter on the Share button
   * (Closure widgets respond to keyboard activation more reliably than
   * .click() — teardown §2.3). Best-effort; the manual steps below cover a
   * miss. */
  const openShareDialog = () => {
    const btn = document.querySelector(ctx.selectors.shareButton);
    if (!btn) {
      logDiag("selector-miss", { key: "shareButton", selector: ctx.selectors.shareButton, timeoutMs: 0 });
      return;
    }
    for (const type of ["keydown", "keypress"] as const) {
      btn.dispatchEvent(
        new KeyboardEvent(type, { key: "Enter", keyCode: 13, bubbles: true, cancelable: true })
      );
    }
  };

  const checkAccess = async () => {
    setChecking(true);
    setDenied(false);
    try {
      const res = await getBackend().checkSheetAccess(ctx.spreadsheetId);
      if (res.granted) ctx.navigate("onboarding-completed");
      else setDenied(true);
    } catch {
      setDenied(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-[18px] font-bold tracking-tight text-ink">
          Share this spreadsheet with DragonSheets
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink/60">
          DragonSheets writes data using a robot account — it can only touch
          spreadsheets you explicitly share with it. Nothing else in your
          Drive.
        </p>
      </div>

      <div className="rounded-xl border border-forest/20 bg-forest/5 p-3">
        <div className="break-all font-mono text-[12px] text-deep">{email || "…"}</div>
        <div className="mt-2">
          <CopyButton value={email} label="Copy email" />
        </div>
      </div>

      <ol className="flex flex-col gap-2 text-[13px] text-ink/70">
        <Step n={1}>
          Click <b>Share</b> (top right of this page) — or{" "}
          <button className="font-semibold text-forest underline underline-offset-2" onClick={openShareDialog}>
            open it for me
          </button>
        </Step>
        <Step n={2}>Paste the email above into “Add people”</Step>
        <Step n={3}>
          Keep the role as <b>Editor</b>, untick “Notify people”, click{" "}
          <b>Send</b>
        </Step>
      </ol>

      <Button onClick={checkAccess} disabled={checking || !email}>
        {checking ? <Spinner /> : null}
        {checking ? "Checking…" : "Check access"}
      </Button>
      {denied ? (
        <p className="text-[12px] text-red-600">
          No access yet — make sure the email was added as an Editor, then try
          again.
        </p>
      ) : null}
      <p className="text-[11px] text-ink/40">
        You can revoke access any time from the same Share dialog.
      </p>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest/10 text-[11px] font-bold text-forest">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}
