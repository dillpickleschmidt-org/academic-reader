/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_MODE: "local" | "datalab" | "modal"
  readonly VITE_CONVEX_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "@fontsource-variable/geist"
declare module "@fontsource-variable/lora"
declare module "@fontsource-variable/source-code-pro"
declare module "@fontsource/architects-daughter"
declare module "@fontsource/libre-baskerville"
declare module "@fontsource/ibm-plex-mono"
declare module "katex/dist/contrib/copy-tex"
