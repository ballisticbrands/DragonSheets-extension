/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mock" (default) | "real" — selects the BackendClient implementation. */
  readonly VITE_BACKEND?: string;
  /** "mock" (default) | "real" — selects the Google sign-in path. */
  readonly VITE_AUTH_MODE?: string;
}

declare module "*.css?inline" {
  const css: string;
  export default css;
}
