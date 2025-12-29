import type { OutputFormat, ProcessingStep } from "../hooks/useConversion";

interface Props {
  fileName: string;
  outputFormat: OutputFormat;
  useLlm: boolean;
  forceOcr: boolean;
  pageRange: string;
  processingStep: ProcessingStep;
  error: string;
}

const STEPS = [
  {
    key: "uploading",
    label: "Uploading",
    description: "Transferring document",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-5 5m5-5l5 5" />
      </svg>
    ),
  },
  {
    key: "parsing",
    label: "Processing",
    description: "Extracting content",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h6" />
      </svg>
    ),
  },
  {
    key: "complete",
    label: "Complete",
    description: "Ready to view",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 7" />
      </svg>
    ),
  },
] as const;

export function ProcessingPage({
  fileName,
  outputFormat,
  useLlm,
  forceOcr,
  pageRange,
  processingStep,
  error,
}: Props) {
  const currentStepIndex = STEPS.findIndex((s) => s.key === processingStep);

  return (
    <div className="page-wrapper">
      <div className="page-content processing-page">
        <header className="page-header">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 19V5a2 2 0 012-2h8a2 2 0 012 2v14M4 19h12M4 19l4-3m8 3l-4-3" />
            </svg>
            <span>Academic Reader</span>
          </div>
        </header>

        <main className="processing-main">
          <div className="processing-visual">
            <div className="processing-ring">
              <svg viewBox="0 0 120 120">
                <circle
                  className="ring-bg"
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  strokeWidth="6"
                />
                <circle
                  className="ring-progress"
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  style={{
                    strokeDasharray: 339.292,
                    strokeDashoffset: 339.292 - (339.292 * ((currentStepIndex + 1) / STEPS.length)),
                  }}
                />
              </svg>
              <div className="processing-icon">
                {processingStep === "complete" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 7" />
                  </svg>
                ) : (
                  <svg className="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364-6.364l-2.121 2.121M8.757 15.243l-2.121 2.121m12.728 0l-2.121-2.121M8.757 8.757L6.636 6.636" />
                  </svg>
                )}
              </div>
            </div>

            <h2 className="processing-title">
              {processingStep === "complete"
                ? "Processing Complete"
                : "Converting Your Document"}
            </h2>
            <p className="processing-subtitle">{fileName}</p>
          </div>

          <div className="processing-steps">
            {STEPS.map((step, index) => {
              const isCompleted = index < currentStepIndex;
              const isActive = index === currentStepIndex;
              const isPending = index > currentStepIndex;

              return (
                <div
                  key={step.key}
                  className={`step-item ${isCompleted ? "completed" : ""} ${isActive ? "active" : ""} ${isPending ? "pending" : ""}`}
                >
                  <div className="step-icon-wrapper">
                    {isCompleted ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 7" />
                      </svg>
                    ) : (
                      step.icon
                    )}
                  </div>
                  <div className="step-content">
                    <span className="step-label">{step.label}</span>
                    <span className="step-description">{step.description}</span>
                  </div>
                  {index < STEPS.length - 1 && <div className="step-connector" />}
                </div>
              );
            })}
          </div>

          <div className="processing-settings">
            <h3 className="section-title">Configuration</h3>
            <div className="settings-list">
              <div className="setting-item">
                <span className="setting-label">Output</span>
                <span className="setting-value">{outputFormat.toUpperCase()}</span>
              </div>
              <div className="setting-item">
                <span className="setting-label">AI Enhancement</span>
                <span className={`setting-value ${useLlm ? "enabled" : ""}`}>
                  {useLlm ? "On" : "Off"}
                </span>
              </div>
              <div className="setting-item">
                <span className="setting-label">OCR</span>
                <span className={`setting-value ${forceOcr ? "enabled" : ""}`}>
                  {forceOcr ? "On" : "Off"}
                </span>
              </div>
              <div className="setting-item">
                <span className="setting-label">Pages</span>
                <span className="setting-value">{pageRange || "All"}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
