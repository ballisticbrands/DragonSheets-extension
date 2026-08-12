/**
 * Onboarding step 2 — share the spreadsheet with the service account
 * (route: share-spreadsheet). The pivotal, highest-friction screen (teardown
 * §5.3): copy-to-clipboard, auto-open Google's Share dialog, check access.
 *
 * The one rule this screen must never break: **it must never render an empty
 * address**. A blank monospace box with a "Copy email" button under it is
 * worse than an error — the user copies nothing, pastes nothing, and has no
 * idea anything went wrong. Every failure path here ends in a sentence and a
 * Retry, never in emptiness.
 */
import { useCallback, useEffect, useState } from "react";
import { trackSheetShared } from "../../analytics";
import { checkAccess, rememberGrant } from "../../backend/sheet-access";
import { openShareDialog, type ShareDialogResult } from "../../content/share-dialog";
import { Button } from "../../ui/Button";
import { CopyButton } from "../../ui/CopyButton";
import { Spinner } from "../../ui/Spinner";
import type { AppContext } from "../App";

type Loaded =
  | { phase: "loading" }
  /** We have an address to show — the only state that renders the copy box. */
  | { phase: "ready"; email: string; granted: boolean; reason?: string }
  /** No address, or the call failed. Shows the reason and a Retry. */
  | { phase: "failed"; message: string };

const GENERIC_FAILURE =
  "We couldn't reach DragonSheets to fetch the address to share with. Check your connection and try again.";

export function ShareSpreadsheet({ ctx }: { ctx: AppContext }) {
  const [state, setState] = useState<Loaded>({ phase: "loading" });
  const [checking, setChecking] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [openHint, setOpenHint] = useState<string | null>(null);

  /**
   * One call answers both questions this screen asks: which address, and does
   * it already have access. The backend returns the address on the denial too
   * — a user with no access yet is precisely the user who needs it.
   */
  const load = useCallback(async () => {
    setState({ phase: "loading" });
    setDenied(null);
    try {
      const res = await checkAccess(ctx.spreadsheetId, { force: true });
      const email = res.serviceAccountEmail ?? "";
      if (!email) {
        // 200 with a null address: the server has no Sheets credentials. No
        // amount of retrying fixes that, so say what the server said.
        setState({
          phase: "failed",
          message:
            res.reason ??
            "The server hasn't been given its Google Sheets credentials yet, so there's no address to share with. Contact support.",
        });
        return;
      }
      setState({
        phase: "ready",
        email,
        granted: res.granted,
        ...(res.reason ? { reason: res.reason } : {}),
      });
    } catch (err) {
      setState({
        phase: "failed",
        message: err instanceof Error && err.message ? err.message : GENERIC_FAILURE,
      });
    }
  }, [ctx.spreadsheetId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Drive Google's own Share button for the user. See content/share-dialog.ts. */
  const openDialog = async () => {
    setOpenHint(null);
    const result: ShareDialogResult = await openShareDialog(ctx.selectors.shareButton);
    if (result.outcome === "opened") return;
    setOpenHint(
      result.outcome === "not-found"
        ? "We couldn't find Google's Share button on this page — click Share at the top right yourself."
        : "Google's Share dialog didn't open. Click Share at the top right of the page instead."
    );
  };

  const check = async () => {
    setChecking(true);
    setDenied(null);
    try {
      const res = await checkAccess(ctx.spreadsheetId, { force: true });
      if (res.granted) {
        // Fires on the CONFIRMED grant, not on the "Check access" click —
        // this is the onboarding step that actually converts, and counting
        // failed checks would flatter it. No spreadsheet id is sent: a
        // document identifier is user content, not a metric.
        void trackSheetShared();
        rememberGrant(ctx.spreadsheetId, true);
        ctx.navigate("onboarding-completed");
      } else {
        setDenied(
          res.reason ??
            "No access yet — make sure the email was added as an Editor, then try again."
        );
      }
    } catch (err) {
      setDenied(err instanceof Error && err.message ? err.message : GENERIC_FAILURE);
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

      {state.phase === "loading" ? (
        <div className="flex h-20 items-center justify-center">
          <Spinner size={20} />
        </div>
      ) : null}

      {state.phase === "failed" ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="text-[12.5px] font-semibold text-red-700">
              Couldn't load the address to share with
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-red-700/80">{state.message}</p>
          </div>
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <>
          <div className="rounded-xl border border-forest/20 bg-forest/5 p-3">
            <div className="break-all font-mono text-[12px] text-deep">{state.email}</div>
            <div className="mt-2">
              <CopyButton value={state.email} label="Copy email" />
            </div>
          </div>

          {/* The instructions stay on screen even once access is granted: this
              screen is reachable deliberately (Settings → Google), and someone
              who came here on purpose usually came to re-open Google's dialog. */}
          {state.granted ? (
            <div className="rounded-xl border border-lime/50 bg-lime/10 p-3">
              <div className="text-[12.5px] font-semibold text-deep">
                This spreadsheet is already shared ✓
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink/60">
                DragonSheets can write here. Revoke it any time from Google's own
                Share dialog.
              </p>
            </div>
          ) : null}

          <ol className="flex flex-col gap-2 text-[13px] text-ink/70">
            <Step n={1}>
              Click <b>Share</b> (top right of this page) — or{" "}
              <button
                className="font-semibold text-forest underline underline-offset-2"
                onClick={() => void openDialog()}
              >
                open it for me
              </button>
            </Step>
            <Step n={2}>Paste the email above into “Add people”</Step>
            <Step n={3}>
              Keep the role as <b>Editor</b>, untick “Notify people”, click{" "}
              <b>Share</b>
            </Step>
          </ol>
          {openHint ? <p className="text-[12px] text-ink/50">{openHint}</p> : null}

          {state.granted ? (
            <Button onClick={() => ctx.navigate("onboarding-completed")}>Continue</Button>
          ) : (
            <>
              <Button onClick={() => void check()} disabled={checking}>
                {checking ? <Spinner /> : null}
                {checking ? "Checking…" : "Check access"}
              </Button>
              {denied ? <p className="text-[12px] text-red-600">{denied}</p> : null}
              {state.reason && !denied ? (
                <p className="text-[12px] text-ink/50">{state.reason}</p>
              ) : null}
            </>
          )}
        </>
      ) : null}

      <p className="text-[11px] text-ink/40">
        You can revoke access any time from the same Share dialog.
      </p>

      {/* Never a dead end. The gate re-asserts itself the next time the panel
          opens (App.tsx), so "later" costs nothing and traps nobody. */}
      <button
        className="rounded text-[11.5px] text-ink/40 underline underline-offset-2 hover:text-ink focus:outline-none focus:ring-2 focus:ring-forest/30"
        onClick={() => ctx.navigate(ctx.session ? "home" : "welcome")}
      >
        Do this later
      </button>
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
