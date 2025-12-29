import {
  FileText,
  Check,
  Code,
  AlignLeft,
  Braces,
  Sparkles,
  ScanLine,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { OutputFormat } from "../hooks/useConversion";

interface Props {
  fileName: string;
  uploadProgress: number;
  uploadComplete: boolean;
  outputFormat: OutputFormat;
  useLlm: boolean;
  forceOcr: boolean;
  pageRange: string;
  error: string;
  onOutputFormatChange: (format: OutputFormat) => void;
  onUseLlmChange: (value: boolean) => void;
  onForceOcrChange: (value: boolean) => void;
  onPageRangeChange: (value: string) => void;
  onStartConversion: () => void;
  onBack: () => void;
}

const FORMAT_OPTIONS = [
  {
    value: "html" as const,
    label: "HTML",
    description: "Best for reading",
    icon: <Code strokeWidth={1.5} />,
  },
  {
    value: "markdown" as const,
    label: "Markdown",
    description: "Plain text",
    icon: <AlignLeft strokeWidth={1.5} />,
  },
  {
    value: "json" as const,
    label: "JSON",
    description: "Structured data",
    icon: <Braces strokeWidth={1.5} />,
  },
];

export function ConfigurePage({
  fileName,
  uploadProgress,
  uploadComplete,
  outputFormat,
  useLlm,
  forceOcr,
  pageRange,
  error,
  onOutputFormatChange,
  onUseLlmChange,
  onForceOcrChange,
  onPageRangeChange,
  onStartConversion,
  onBack,
}: Props) {
  return (
    <div className="app-page">
      <div className="app-page-header">Academic Reader</div>

      <main className="app-page-main">
        <div className="configure-content">
          <div className="file-card">
            <div className="file-info">
              <div className="file-icon">
                <FileText strokeWidth={1.5} />
              </div>
              <div className="file-details">
                <span className="file-name">{fileName}</span>
                <span className="file-status">
                  {uploadComplete ? (
                    <>
                      <Check strokeWidth={2} />
                      Ready to convert
                    </>
                  ) : (
                    `Uploading... ${uploadProgress}%`
                  )}
                </span>
              </div>
            </div>
            {!uploadComplete && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </div>

          <section className="config-section">
            <h2 className="section-title">Output Format</h2>
            <div className="format-grid">
              {FORMAT_OPTIONS.map((format) => (
                <button
                  key={format.value}
                  className={`format-option ${outputFormat === format.value ? "selected" : ""}`}
                  onClick={() => onOutputFormatChange(format.value)}
                >
                  <div className="format-icon">{format.icon}</div>
                  <div className="format-label">{format.label}</div>
                  <div className="format-description">{format.description}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="config-section">
            <h2 className="section-title">Processing Options</h2>
            <div className="options-grid">
              <label className={`toggle-option ${useLlm ? "active" : ""}`}>
                <div className="toggle-content">
                  <div className="toggle-icon">
                    <Sparkles strokeWidth={1.5} />
                  </div>
                  <div className="toggle-text">
                    <span className="toggle-label">AI Enhancement</span>
                    <span className="toggle-hint">Better for tables & equations</span>
                  </div>
                </div>
                <div className={`toggle-switch ${useLlm ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={useLlm}
                    onChange={(e) => onUseLlmChange(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </div>
              </label>

              <label className={`toggle-option ${forceOcr ? "active" : ""}`}>
                <div className="toggle-content">
                  <div className="toggle-icon">
                    <ScanLine strokeWidth={1.5} />
                  </div>
                  <div className="toggle-text">
                    <span className="toggle-label">Force OCR</span>
                    <span className="toggle-hint">For scanned documents</span>
                  </div>
                </div>
                <div className={`toggle-switch ${forceOcr ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={forceOcr}
                    onChange={(e) => onForceOcrChange(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </div>
              </label>
            </div>
          </section>

          <section className="config-section">
            <h2 className="section-title">Page Range</h2>
            <div className="page-range-input">
              <input
                type="text"
                placeholder="All pages (or specify: 1-5, 10, 15-20)"
                value={pageRange}
                onChange={(e) => onPageRangeChange(e.target.value)}
              />
            </div>
          </section>

          <div className="action-buttons">
            <button className="btn btn-secondary" onClick={onBack}>
              <ArrowLeft strokeWidth={2} />
              Back
            </button>
            <button
              className="btn btn-primary btn-convert"
              onClick={onStartConversion}
              disabled={!uploadComplete}
            >
              {uploadComplete ? (
                <>
                  <ArrowRight strokeWidth={2} />
                  Convert
                </>
              ) : (
                <>
                  <Loader2 className="btn-spinner" strokeWidth={2} />
                  Uploading...
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="error-banner">
              <AlertCircle strokeWidth={1.5} />
              <span>{error}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
