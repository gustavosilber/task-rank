/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string
  readonly VITE_TEAMWORK_SITE_URL: string
  readonly VITE_TEAMWORK_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
