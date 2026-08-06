import { useState } from "react";
import { Button } from "./Button";

/** Copy-to-clipboard with a 3s "Copied" flip — the exact affordance hopted
 * uses on the share-service-account screen (teardown §5.3). */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
        } catch {
          // Clipboard can be blocked; leave the button as-is.
        }
      }}
    >
      {copied ? "Copied ✓" : label}
    </Button>
  );
}
