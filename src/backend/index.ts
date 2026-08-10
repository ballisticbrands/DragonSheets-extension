import { MockBackend } from "./mock";
import { RealBackend } from "./real";
import type { BackendClient } from "./types";

export type BackendMode = "mock" | "real";

/**
 * THE SEAM. One environment variable decides which `BackendClient` the whole
 * extension gets, and nothing else in the codebase is allowed to care.
 *
 *   VITE_BACKEND=real  → RealBackend  (api.getdragonbot.com)
 *   anything else      → MockBackend  (default — the demo/QA path)
 *
 * Mock stays the default deliberately: the packaged build, the browser smoke
 * test and every screenshot in the store listing run against it, and none of
 * them should start depending on a live backend and a real Amazon account.
 */
export function getBackendMode(): BackendMode {
  return import.meta.env.VITE_BACKEND === "real" ? "real" : "mock";
}

let instance: BackendClient | null = null;

export function getBackend(): BackendClient {
  if (instance) return instance;
  instance = getBackendMode() === "real" ? new RealBackend() : new MockBackend();
  return instance;
}

export type { BackendClient } from "./types";
export { NotImplementedYetError } from "./real";
