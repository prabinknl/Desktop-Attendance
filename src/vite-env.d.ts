/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for hosted builds, e.g. https://attendance-api.fly.dev/api.
   *  Unset locally so requests go through the Vite proxy on /api. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
