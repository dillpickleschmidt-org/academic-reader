import { Check, Upload, AlignLeft, Loader2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { OutputFormat, ProcessingStep } from "../hooks/useConversion"

interface Props {
  fileName: string
  outputFormat: OutputFormat
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
  processingStep: ProcessingStep
  error: string
}

const STEPS = [
  {
    key: "uploading",
    label: "Uploading",
    description: "Transferring document",
    icon: <Upload className="w-4 h-4" strokeWidth={1.5} />,
  },
  {
    key: "parsing",
    label: "Processing",
    description: "Extracting content",
    icon: <AlignLeft className="w-4 h-4" strokeWidth={1.5} />,
  },
  {
    key: "complete",
    label: "Complete",
    description: "Ready to view",
    icon: <Check className="w-4 h-4" strokeWidth={1.5} />,
  },
] as const

export function ProcessingPage({
  fileName,
  outputFormat,
  useLlm,
  forceOcr,
  pageRange,
  processingStep,
  error,
}: Props) {
  const currentStepIndex = STEPS.findIndex((s) => s.key === processingStep)

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8 max-sm:p-4 max-sm:items-start max-sm:pt-6">
      <div className="w-full max-w-[480px]">
        {/* Header */}
        <header className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-muted-foreground">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 19V5a2 2 0 012-2h8a2 2 0 012 2v14M4 19h12M4 19l4-3m8 3l-4-3" />
            </svg>
            <span className="text-base font-medium">Academic Reader</span>
          </div>
        </header>

        <main className="flex flex-col gap-6">
          {/* Processing Visual */}
          <div className="text-center">
            <div className="relative w-[100px] h-[100px] mx-auto mb-4">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle
                  className="stroke-border"
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  strokeWidth="6"
                />
                <circle
                  className="stroke-primary transition-[stroke-dashoffset] duration-500"
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  style={{
                    strokeDasharray: 339.292,
                    strokeDashoffset:
                      339.292 -
                      339.292 * ((currentStepIndex + 1) / STEPS.length),
                  }}
                />
              </svg>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 text-primary">
                {processingStep === "complete" ? (
                  <Check className="w-full h-full" strokeWidth={2} />
                ) : (
                  <Loader2
                    className="w-full h-full animate-spin"
                    strokeWidth={2}
                  />
                )}
              </div>
            </div>

            <h2 className="text-lg font-semibold text-foreground mb-1">
              {processingStep === "complete"
                ? "Processing Complete"
                : "Converting Your Document"}
            </h2>
            <p className="text-sm text-muted-foreground">{fileName}</p>
          </div>

          {/* Processing Steps */}
          <Card className="bg-secondary/50 border-border">
            <CardContent className="p-4">
              {STEPS.map((step, index) => {
                const isCompleted = index < currentStepIndex
                const isActive = index === currentStepIndex
                const isPending = index > currentStepIndex

                return (
                  <div
                    key={step.key}
                    className={cn(
                      "flex items-center gap-3 py-2 relative",
                      index < STEPS.length - 1 && "pb-5",
                    )}
                  >
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-[1]",
                        isCompleted &&
                          "bg-green-500/15 text-green-600 dark:text-green-500",
                        isActive && "bg-muted text-foreground",
                        isPending && "bg-muted text-muted-foreground",
                      )}
                    >
                      {isCompleted ? (
                        <Check className="w-4 h-4" strokeWidth={2} />
                      ) : (
                        step.icon
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span
                        className={cn(
                          "font-medium text-sm",
                          isPending
                            ? "text-muted-foreground"
                            : "text-foreground",
                        )}
                      >
                        {step.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {step.description}
                      </span>
                    </div>
                    {index < STEPS.length - 1 && (
                      <div
                        className={cn(
                          "absolute left-[15px] top-[42px] w-0.5 h-[calc(100%-42px)]",
                          isCompleted
                            ? "bg-green-600 dark:bg-green-500"
                            : "bg-border",
                        )}
                      />
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {/* Configuration Summary */}
          <Card className="bg-secondary/50 border-border">
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-3">
              <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                <div className="flex justify-between py-1">
                  <span className="text-xs text-muted-foreground">Output</span>
                  <span className="font-medium text-xs text-foreground">
                    {outputFormat.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-xs text-muted-foreground">
                    AI Enhancement
                  </span>
                  <span
                    className={cn(
                      "font-medium text-xs",
                      useLlm
                        ? "text-green-600 dark:text-green-500"
                        : "text-foreground",
                    )}
                  >
                    {useLlm ? "On" : "Off"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-xs text-muted-foreground">OCR</span>
                  <span
                    className={cn(
                      "font-medium text-xs",
                      forceOcr
                        ? "text-green-600 dark:text-green-500"
                        : "text-foreground",
                    )}
                  >
                    {forceOcr ? "On" : "Off"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-xs text-muted-foreground">Pages</span>
                  <span className="font-medium text-xs text-foreground">
                    {pageRange || "All"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error Banner */}
          {error && (
            <div className="flex items-center gap-2 py-3 px-4 bg-destructive/10 rounded-md text-destructive text-sm">
              <AlertCircle
                className="w-[18px] h-[18px] shrink-0"
                strokeWidth={1.5}
              />
              <span>{error}</span>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
