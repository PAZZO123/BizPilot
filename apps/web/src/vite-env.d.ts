/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute base URL of the API, e.g. https://bizpilot-api.onrender.com/api.
   *  Unset in development, where the Vite proxy handles /api. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
