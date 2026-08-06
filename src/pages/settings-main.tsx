/** Options page (manifest options_page: settings.html) — simple settings. */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getAuthMode } from "../auth";
import { getBackend } from "../backend";
import type { Session } from "../backend/types";
import { STORAGE_KEYS, storageGet } from "../lib/storage";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import "../app/styles.css";

function SettingsPage() {
  const manifest = chrome.runtime.getManifest();
  const [session, setSession] = useState<Session | null>(null);
  const [serviceEmail, setServiceEmail] = useState("");
  const [attribution, setAttribution] = useState<unknown>(null);

  const refresh = async () => {
    const backend = getBackend();
    setSession(await backend.getSession());
    setServiceEmail(await backend.getServiceAccountEmail());
    setAttribution(await storageGet(STORAGE_KEYS.attribution));
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 bg-white p-8 font-sans text-ink">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest text-[13px] font-bold text-white">
          DS
        </span>
        <div>
          <h1 className="text-[18px] font-bold tracking-tight">DragonSheets</h1>
          <p className="text-[12px] text-ink/50">
            v{manifest.version} · backend: mock · auth: {getAuthMode()}
          </p>
        </div>
      </div>

      <Card>
        <h2 className="text-[14px] font-semibold">Account</h2>
        {session ? (
          <div className="mt-2 text-[13px] text-ink/70">
            <p>
              {session.name} — {session.email}
            </p>
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={() => void getBackend().signOut().then(refresh)}
              >
                Sign out (clears mock state)
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-ink/50">
            Not signed in. Open any Google Sheet and click the DragonSheets
            button in the toolbar to get started.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="text-[14px] font-semibold">Sheets writer service account</h2>
        <p className="mt-2 break-all font-mono text-[12px] text-ink/70">{serviceEmail}</p>
        <p className="mt-1 text-[12px] text-ink/50">
          DragonSheets can only touch spreadsheets you explicitly share with
          this address.
        </p>
      </Card>

      <Card>
        <h2 className="text-[14px] font-semibold">Install attribution</h2>
        <p className="mt-2 break-all font-mono text-[11px] text-ink/50">
          {attribution ? JSON.stringify(attribution) : "none received"}
        </p>
      </Card>

      <p className="text-[12px] text-ink/40">
        <a
          className="text-forest underline underline-offset-2"
          href="https://go.getdragonsheets.com/privacy/"
          target="_blank"
          rel="noreferrer"
        >
          Privacy policy
        </a>
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsPage />
  </StrictMode>
);
