/**
 * Structured, single-line console diagnostics.
 *
 * Every operational event (selector miss, loader failure, bootstrap fetch
 * problem) is exactly one `console.info` line prefixed `[dragonsheets]` with a
 * JSON payload — greppable in user-supplied console dumps and machine-parseable
 * if we ever wire a log gateway (hopted ships these to POST /LogGateway/log;
 * ours stay local until the backend exists).
 */
export function logDiag(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.info(
      "[dragonsheets] " +
        JSON.stringify({
          event,
          v: chrome?.runtime?.getManifest?.().version ?? "unknown",
          ...data,
        })
    );
  } catch {
    // Diagnostics must never throw.
  }
}
