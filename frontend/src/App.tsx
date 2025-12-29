import "./App.css";
import "./reader.css";
import { useConversion } from "./hooks/useConversion";
import { UploadPage } from "./pages/UploadPage";
import { ConfigurePage } from "./pages/ConfigurePage";
import { ProcessingPage } from "./pages/ProcessingPage";
import { ResultPage } from "./pages/ResultPage";

function App() {
  const conversion = useConversion();

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
      );

    case "configure":
      return (
        <ConfigurePage
          fileName={conversion.fileName}
          uploadProgress={conversion.uploadProgress}
          uploadComplete={conversion.uploadComplete}
          outputFormat={conversion.outputFormat}
          useLlm={conversion.useLlm}
          forceOcr={conversion.forceOcr}
          pageRange={conversion.pageRange}
          error={conversion.error}
          onOutputFormatChange={conversion.setOutputFormat}
          onUseLlmChange={conversion.setUseLlm}
          onForceOcrChange={conversion.setForceOcr}
          onPageRangeChange={conversion.setPageRange}
          onStartConversion={conversion.startConversion}
          onBack={conversion.reset}
        />
      );

    case "processing":
      return (
        <ProcessingPage
          fileName={conversion.fileName}
          outputFormat={conversion.outputFormat}
          useLlm={conversion.useLlm}
          forceOcr={conversion.forceOcr}
          pageRange={conversion.pageRange}
          processingStep={conversion.processingStep}
          error={conversion.error}
        />
      );

    case "result":
      return (
        <ResultPage
          fileName={conversion.fileName}
          outputFormat={conversion.outputFormat}
          content={conversion.content}
          onDownload={conversion.downloadResult}
          onReset={conversion.reset}
        />
      );
  }
}

export default App;
