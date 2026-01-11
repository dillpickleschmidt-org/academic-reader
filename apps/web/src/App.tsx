import { lazy, Suspense } from "react"
import { Loader2 } from "lucide-react"
import { useConversion } from "./hooks/use-conversion"
import { UploadPage } from "./pages/UploadPage"

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
)

const ConfigureProcessingPage = lazy(() =>
  import("./pages/ConfigureProcessingPage").then((m) => ({
    default: m.ConfigureProcessingPage,
  })),
)
const ResultPage = lazy(() =>
  import("./pages/ResultPage").then((m) => ({ default: m.ResultPage })),
)

function App() {
  const conversion = useConversion()

  switch (conversion.page) {
    case "upload":
      return (
        <UploadPage
          url={conversion.url}
          error={conversion.error}
          onUrlChange={conversion.setUrl}
          onFileSelect={conversion.uploadFile}
          onFetchUrl={conversion.fetchFromUrl}
        />
      )

    case "configure":
    case "processing":
      return (
        <Suspense fallback={<PageLoader />}>
          <ConfigureProcessingPage
            fileName={conversion.fileName}
            uploadProgress={conversion.uploadProgress}
            uploadComplete={conversion.uploadComplete}
            outputFormat={conversion.outputFormat}
            useLlm={conversion.useLlm}
            forceOcr={conversion.forceOcr}
            pageRange={conversion.pageRange}
            error={conversion.error}
            isProcessing={conversion.page === "processing"}
            stages={conversion.stages}
            onOutputFormatChange={conversion.setOutputFormat}
            onUseLlmChange={conversion.setUseLlm}
            onForceOcrChange={conversion.setForceOcr}
            onPageRangeChange={conversion.setPageRange}
            onStartConversion={conversion.startConversion}
            onBack={conversion.reset}
          />
        </Suspense>
      )

    case "result":
      return (
        <Suspense fallback={<PageLoader />}>
          <ResultPage
            outputFormat={conversion.outputFormat}
            content={conversion.content}
            imagesReady={conversion.imagesReady}
            chunks={conversion.chunks}
            markdown={conversion.markdown}
            filename={conversion.fileName}
            onDownload={conversion.downloadResult}
            onReset={conversion.reset}
          />
        </Suspense>
      )

    default: {
      const _exhaustive: never = conversion.page
      throw new Error(`Unhandled page: ${_exhaustive}`)
    }
  }
}

export default App
