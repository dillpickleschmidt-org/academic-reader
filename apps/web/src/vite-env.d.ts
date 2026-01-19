/// <reference types="vite/client" />

declare module "*.css?raw" {
  const content: string
  export default content
}

declare module "katex/dist/contrib/copy-tex"

// Fontsource packages (CSS-only, side-effect imports)
declare module "@fontsource-variable/geist"
declare module "@fontsource-variable/lora"
declare module "@fontsource-variable/source-code-pro"
declare module "@fontsource/architects-daughter"
declare module "@fontsource/libre-baskerville"
declare module "@fontsource/ibm-plex-mono"
