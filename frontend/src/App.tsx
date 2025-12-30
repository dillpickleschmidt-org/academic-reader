import "./styles/base-result.css"
import "./styles/html-result.css"
import "./styles/markdown-result.css"
import "./styles/json-result.css"
import { useConversion } from "./hooks/useConversion"
import { UploadPage } from "./pages/UploadPage"
import { ConfigureProcessingPage } from "./pages/ConfigureProcessingPage"
import { ResultPage } from "./pages/ResultPage"

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
      )

    case "result":
      return (
        <ResultPage
          fileName={conversion.fileName}
          outputFormat={conversion.outputFormat}
          content={conversion.content}
          imagesReady={conversion.imagesReady}
          onDownload={conversion.downloadResult}
          onReset={conversion.reset}
        />
      )
  }
}

export default App
