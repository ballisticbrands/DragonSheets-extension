import { MockBackend } from "./mock";
import type { BackendClient } from "./types";

let instance: BackendClient | null = null;

/**
 * Backend factory. `VITE_BACKEND=real` selects the (not yet implemented) real
 * client; everything defaults to the mock. Phase 8 adds RealBackend here —
 * nothing else in the codebase should care which one it gets.
 */
export function getBackend(): BackendClient {
  if (instance) return instance;
  const mode = import.meta.env.VITE_BACKEND === "real" ? "real" : "mock";
  if (mode === "real") {
    throw new Error(
      "RealBackend is not implemented yet (DRAGONSHEETS_PLAN.md Phase 8). Build without VITE_BACKEND=real."
    );
  }
  instance = new MockBackend();
  return instance;
}

export type { BackendClient } from "./types";
