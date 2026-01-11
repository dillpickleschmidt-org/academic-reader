import {
  FileText,
  Check,
  Code,
  AlignLeft,
  Braces,
  ScanLine,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Sparkles,
  Circle,
  X,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@repo/core/lib/utils"
import { Button } from "@repo/core/ui/primitives/button"
import { Input } from "@repo/core/ui/primitives/input"
import { Switch } from "@repo/core/ui/primitives/switch"
import { InfoTooltip } from "@repo/core/ui/info-tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/core/ui/primitives/select"
import type { OutputFormat, StageInfo } from "../hooks/use-conversion"

const FORMAT_OPTIONS: {
  value: OutputFormat
  icon: LucideIcon
  label: string
  recommended?: boolean
}[] = [
  { value: "html", icon: Code, label: "HTML", recommended: true },
  { value: "markdown", icon: AlignLeft, label: "Markdown" },
  { value: "json", icon: Braces, label: "JSON" },
]

const PROCESSING_STEPS = [
  { id: "layout", label: "Recognizing layout" },
  { id: "ocr-error", label: "Running OCR Error Detection" },
  { id: "bboxes", label: "Detecting bboxes" },
  { id: "text", label: "Recognizing Text" },
]

interface Props {
  fileName: string
  uploadProgress: number
  uploadComplete: boolean
  outputFormat: OutputFormat
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
  error: string
  isProcessing: boolean
  isCancelling: boolean
  stages: StageInfo[]
  onOutputFormatChange: (format: OutputFormat) => void
  onUseLlmChange: (value: boolean) => void
  onForceOcrChange: (value: boolean) => void
  onPageRangeChange: (value: string) => void
  onStartConversion: () => void
  onCancel: () => void
  onBack: () => void
}

type Step = "upload" | "configure" | "convert"

function StepIndicator({
  step,
  label,
  isComplete,
  isActive,
  isProcessing,
}: {
  step: number
  label: string
  isComplete: boolean
  isActive: boolean
  isProcessing?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
          isComplete
            ? "bg-primary text-primary-foreground"
            : isActive
              ? "bg-primary/10 text-primary border border-primary"
              : "bg-muted text-muted-foreground",
        )}
      >
        {isComplete ? (
          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
        ) : isProcessing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.5} />
        ) : (
          step
        )}
      </div>
      <span
        className={cn(
          "text-sm transition-colors",
          isComplete || isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  )
}

function ProcessingStepItem({
  label,
  status,
  progress,
}: {
  label: string
  status: "pending" | "active" | "completed"
  progress: { current: number; total: number; elapsed: number } | null
}) {
  const isExpanded = status === "active" && progress
  const percentage = progress
    ? progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
    : 0

  return (
    <div className="py-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {status === "completed" ? (
            <Check className="w-4 h-4 text-green-600 dark:text-green-500" />
          ) : status === "active" ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          ) : (
            <Circle className="w-4 h-4 text-muted-foreground/40" />
          )}
          <span
            className={cn(
              "text-sm transition-colors",
              status === "pending"
                ? "text-muted-foreground/60"
                : "text-foreground",
            )}
          >
            {label}
          </span>
        </div>
        {status === "completed" && progress && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {progress.elapsed.toFixed(1)}s
          </span>
        )}
      </div>

      {/* Expandable progress section */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-out ml-6.5",
          isExpanded ? "max-h-20 opacity-100 mt-2" : "max-h-0 opacity-0",
        )}
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-10">
              {progress?.elapsed.toFixed(1)}s
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress?.current} / {progress?.total}
            </span>
            <span className="mr-13">{percentage}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProcessingView({ stages }: { stages: StageInfo[] }) {
  // Map stage names to our known steps
  const getStepStatus = (
    stepLabel: string,
  ): {
    status: "pending" | "active" | "completed"
    progress: { current: number; total: number; elapsed: number } | null
  } => {
    const stage = stages.find((s) => s.stage === stepLabel)
    if (!stage) {
      // Check if any later step is active/completed (meaning this one is done)
      const stepIndex = PROCESSING_STEPS.findIndex((s) => s.label === stepLabel)
      const laterStageActive = stages.some((s) => {
        const sIndex = PROCESSING_STEPS.findIndex((ps) => ps.label === s.stage)
        return sIndex > stepIndex
      })
      if (laterStageActive) {
        return { status: "completed", progress: null }
      }
      return { status: "pending", progress: null }
    }

    if (stage.completed) {
      return {
        status: "completed",
        progress: {
          current: stage.total,
          total: stage.total,
          elapsed: stage.elapsed,
        },
      }
    }

    return {
      status: "active",
      progress: {
        current: stage.current,
        total: stage.total,
        elapsed: stage.elapsed,
      },
    }
  }

  return (
    <div className="flex flex-col">
      {PROCESSING_STEPS.map((step) => {
        const { status, progress } = getStepStatus(step.label)
        return (
          <ProcessingStepItem
            key={step.id}
            label={step.label}
            status={status}
            progress={progress}
          />
        )
      })}
    </div>
  )
}

export function ConfigureProcessingPage({
  fileName,
  uploadProgress,
  uploadComplete,
  outputFormat,
  useLlm,
  forceOcr,
  pageRange,
  error,
  isProcessing,
  isCancelling,
  stages,
  onOutputFormatChange,
  onUseLlmChange,
  onForceOcrChange,
  onPageRangeChange,
  onStartConversion,
  onCancel,
  onBack,
}: Props) {
  const currentStep: Step = isProcessing ? "convert" : "configure"

  return (
    <div className="min-h-screen flex flex-col p-6 px-5 bg-background">
      <div className="flex items-center gap-2 text-base font-medium text-muted-foreground">
        Academic Reader
      </div>

      <main className="flex flex-col items-center justify-center flex-1 pb-16">
        <div className="w-full max-w-[720px] grid gap-8 grid-cols-[240px_1fr] max-sm:grid-cols-1">
          {/* Steps Panel */}
          <div
            className={cn(
              "flex flex-col gap-5 p-6 rounded-xl border border-border",
              "transition-all duration-300 ease-out",
            )}
          >
            {/* File info */}
            <div className="pb-4 border-b border-border">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                <span className="truncate max-w-[180px] text-foreground font-medium">
                  {fileName}
                </span>
                {uploadComplete && (
                  <Check
                    className="w-4 h-4 text-green-600 dark:text-green-500 shrink-0"
                    strokeWidth={2}
                  />
                )}
              </div>
              {!uploadComplete && (
                <div className="mt-1.5 text-xs text-muted-foreground">
                  Uploading... {uploadProgress}%
                </div>
              )}
            </div>

            {/* Steps */}
            <div className="flex flex-col gap-4">
              <StepIndicator
                step={1}
                label="Upload"
                isComplete={uploadComplete}
                isActive={!uploadComplete}
              />
              <StepIndicator
                step={2}
                label="Configure"
                isComplete={isProcessing}
                isActive={currentStep === "configure"}
              />
              <StepIndicator
                step={3}
                label={isProcessing ? "Converting..." : "Convert"}
                isComplete={false}
                isActive={currentStep === "convert"}
                isProcessing={isProcessing}
              />
            </div>
          </div>

          {/* Right Panel - Config or Processing */}
          <div
            className={cn(
              "flex flex-col gap-6 p-6 rounded-xl border border-border",
              "transition-all duration-300 ease-out",
            )}
          >
            {isProcessing ? (
              <>
                <ProcessingView stages={stages} />
                <div className="mt-4">
                  <Button
                    variant="outline"
                    onClick={onCancel}
                    disabled={isCancelling}
                    className="h-10"
                  >
                    {isCancelling ? (
                      <>
                        <Loader2
                          className="w-4 h-4 mr-2 animate-spin"
                          strokeWidth={2}
                        />
                        Cancelling...
                      </>
                    ) : (
                      <>
                        <X className="w-4 h-4 mr-2" strokeWidth={2} />
                        Cancel
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Output Format */}
                <div>
                  <label
                    htmlFor="output-format-select"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Output Format
                  </label>
                  <Select
                    value={outputFormat}
                    onValueChange={(value) =>
                      onOutputFormatChange(value as OutputFormat)
                    }
                  >
                    <SelectTrigger
                      id="output-format-select"
                      className="w-full h-10"
                    >
                      <SelectValue>
                        {(() => {
                          const opt = FORMAT_OPTIONS.find(
                            (o) => o.value === outputFormat,
                          )
                          if (!opt) return null
                          const Icon = opt.icon
                          return (
                            <span className="flex items-center gap-2">
                              <Icon className="w-4 h-4" strokeWidth={1.5} />
                              <span>{opt.label}</span>
                              {opt.recommended && (
                                <span className="text-muted-foreground text-xs">
                                  (Recommended)
                                </span>
                              )}
                            </span>
                          )
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {FORMAT_OPTIONS.map((opt) => {
                        const Icon = opt.icon
                        return (
                          <SelectItem key={opt.value} value={opt.value}>
                            <Icon className="w-4 h-4" strokeWidth={1.5} />
                            {opt.label}
                            {opt.recommended && (
                              <span className="text-muted-foreground text-xs ml-1">
                                (Recommended)
                              </span>
                            )}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Page Range */}
                <div>
                  <label
                    htmlFor="page-range"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Page Range{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </label>
                  <Input
                    id="page-range"
                    type="text"
                    className="h-10"
                    placeholder="All pages — or specify: 1-5, 10, 15-20"
                    value={pageRange}
                    onChange={(e) => onPageRangeChange(e.target.value)}
                  />
                </div>

                {/* Options */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center bg-muted text-muted-foreground">
                        <Sparkles className="w-4 h-4" strokeWidth={1.5} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          Enhanced Detection
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <span>
                            Use Gemini Flash 2 for better tables & equations
                          </span>
                          <InfoTooltip
                            variant="info"
                            content="Note that Google collects anything read by Gemini for training purposes."
                            side="top"
                          />
                        </div>
                      </div>
                    </div>
                    <Switch checked={useLlm} onCheckedChange={onUseLlmChange} />
                  </div>

                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center bg-muted text-muted-foreground">
                        <ScanLine className="w-4 h-4" strokeWidth={1.5} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          Force OCR
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <span>Can help with equations</span>
                          <InfoTooltip
                            content="This is only applicable to searchable, text-based PDFs since scanned documents are subjected to OCR automatically."
                            side="top"
                          />
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={forceOcr}
                      onCheckedChange={onForceOcrChange}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-2">
                  <Button variant="outline" onClick={onBack} className="h-10">
                    <ArrowLeft className="w-4 h-4 mr-2" strokeWidth={2} />
                    Back
                  </Button>
                  <Button
                    onClick={onStartConversion}
                    disabled={!uploadComplete}
                    className="flex-1 h-10"
                  >
                    {uploadComplete ? (
                      "Convert"
                    ) : (
                      <>
                        <Loader2
                          className="w-4 h-4 mr-2 animate-spin"
                          strokeWidth={2}
                        />
                        Uploading...
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-6 flex items-center gap-2 py-3 px-4 bg-destructive/10 rounded-lg text-destructive text-sm max-w-180">
            <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span>{error}</span>
          </div>
        )}
      </main>
    </div>
  )
}
