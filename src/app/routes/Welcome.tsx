/** Onboarding step 1 — value prop + Sign in with Google (route: welcome). */
import { useState } from "react";
import { signInWithGoogle } from "../../auth";
import { getBackend } from "../../backend";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import type { AppContext } from "../App";

export function Welcome({ ctx }: { ctx: AppContext }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      await ctx.refreshSession();
      // If this spreadsheet already granted access (e.g. re-install), skip
      // straight past the share step.
      const access = await getBackend()
        .checkSheetAccess(ctx.spreadsheetId)
        .catch(() => null);
      ctx.navigate(access?.granted ? "onboarding-completed" : "share-spreadsheet");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 pt-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-forest text-lg font-bold text-white">
        DS
      </div>
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">
          Amazon data, live in this sheet
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink/60">
          Seller Central and PPC reports that refresh themselves. No CSV
          exports, no copy-paste. Set it up once — 2 minutes.
        </p>
      </div>
      <ul className="mx-auto flex flex-col gap-2 text-left text-[13px] text-ink/70">
        <li className="flex items-center gap-2">
          <Dot /> Orders, inventory, fees, returns — synced on a schedule
        </li>
        <li className="flex items-center gap-2">
          <Dot /> Sponsored Products, Brands & Display down to search terms
        </li>
        <li className="flex items-center gap-2">
          <Dot /> Ask the AI for a report — it builds the sheet
        </li>
      </ul>
      <div className="mx-auto w-full max-w-[260px]">
        <Button className="w-full" onClick={onSignIn} disabled={busy}>
          {busy ? <Spinner /> : null}
          {busy ? "Signing in…" : "Sign in with Google"}
        </Button>
      </div>
      {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
      <p className="text-[11px] text-ink/40">
        Sign-in only shares your name and email. DragonSheets never gets
        Google Drive access — you share one spreadsheet, explicitly, in the
        next step.
      </p>
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />;
}
