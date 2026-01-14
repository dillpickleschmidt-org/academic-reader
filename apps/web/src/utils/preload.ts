/**
 * Preload utilities for lazy-loaded components.
 * Separated to avoid circular imports between App.tsx and hooks.
 */

// Preloadable ResultPage - call preloadResultPage() to start loading early
export const resultPageImport = () =>
  import("../pages/ResultPage").then((m) => ({ default: m.ResultPage }))

export const preloadResultPage = () => resultPageImport()
