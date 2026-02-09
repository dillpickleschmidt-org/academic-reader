export const resultPageImport = () =>
  import("../pages/ResultPage").then((m) => ({ default: m.ResultPage }))

export const preloadResultPage = () => resultPageImport()
