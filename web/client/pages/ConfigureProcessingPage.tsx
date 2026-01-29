import { useState } from "react"
import {
  FileText,
  Check,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Sparkles,
  Circle,
  X,
  ChevronDown,
} from "lucide-react"
import { cn } from "@repo/core/lib/utils"
import { Button } from "@repo/core/ui/primitives/button"
import { Input } from "@repo/core/ui/primitives/input"
import { Switch } from "@repo/core/ui/primitives/switch"
import {
  RadioGroup,
  RadioGroupItem,
} from "@repo/core/ui/primitives/radio-group"
import {
  Field,
  FieldLabel,
  FieldContent,
  FieldTitle,
  FieldDescription,
} from "@repo/core/ui/primitives/field"
import { InfoTooltip } from "@repo/core/ui/info-tooltip"
import type { ProcessingMode, StageInfo } from "../hooks/use-conversion"
import type { BackendType } from "@repo/core/types/api"
import { useAppConfig } from "../hooks/use-app-config"

const AGGRESSIVE_MODE_SUPPORTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/tiff",
]

const MODE_OPTIONS: {
  value: ProcessingMode
  label: string
  description: string
}[] = [
  {
    value: "fast",
    label: "Fast (preferred)",
    description:
      "Works well with books and handles multi-span tables well with llm support.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description:
      "Slightly slower and more agressive at converting diagrms to plain text instead of images. Your mileage may vary.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    description:
      "Even slower and more agressive at converting diagrams to plain text instead of images. Your mileage may vary.",
  },
]

interface Props {
  fileName: string
  fileMimeType: string
  pageCount?: number
  uploadProgress: number
  uploadComplete: boolean
  backendMode: BackendType
  processingMode: ProcessingMode
  useLlm: boolean
  pageRange: string
  error: string
  isProcessing: boolean
  isCancelling: boolean
  stages: StageInfo[]
  onProcessingModeChange: (mode: ProcessingMode) => void
  onUseLlmChange: (value: boolean) => void
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
  progress: { current: number; total: number } | null
}) {
  const isIndeterminate = progress && progress.total === 0
  const isExpanded = status === "active" && progress && !isIndeterminate
  const percentage = progress
    ? progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
    : 0

  return (
    <div className="py-2">
      {/* Header row */}
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

      {/* Indeterminate progress bar (for model loading) */}
      {status === "active" && isIndeterminate && (
        <div className="ml-6.5 mt-2">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full w-1/3 bg-primary rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]" />
          </div>
        </div>
      )}

      {/* Determinate progress bar */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-out ml-6.5",
          isExpanded ? "max-h-12 opacity-100 mt-2" : "max-h-0 opacity-0",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {progress?.current}/{progress?.total}
          </span>
        </div>
      </div>
    </div>
  )
}

function ProcessingView({ stages }: { stages: StageInfo[] }) {
  // Display stages dynamically as they arrive from SSE
  // Each stage can be pending, active, or completed
  if (stages.length === 0) {
    // No stages yet - show initial loading
    return (
      <div className="flex flex-col">
        <ProcessingStepItem
          label="Starting..."
          status="active"
          progress={{ current: 0, total: 0 }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {stages.map((stage, index) => {
        const isLast = index === stages.length - 1
        const status = stage.completed
          ? "completed"
          : isLast
            ? "active"
            : "completed"

        return (
          <ProcessingStepItem
            key={stage.stage}
            label={stage.stage}
            status={status}
            progress={{
              current: stage.current,
              total: stage.total,
            }}
          />
        )
      })}
    </div>
  )
}

function ProcessingModeSelector({
  processingMode,
  onProcessingModeChange,
  fileMimeType,
  backendMode,
}: {
  processingMode: ProcessingMode
  onProcessingModeChange: (mode: ProcessingMode) => void
  fileMimeType: string
  backendMode: BackendType
}) {
  const [isExpanded, setIsExpanded] = useState(processingMode !== "fast")
  const currentMode = MODE_OPTIONS.find((m) => m.value === processingMode)

  // When user selects a non-fast mode, keep expanded
  // When they select fast, allow collapsing
  const handleModeChange = (value: ProcessingMode) => {
    onProcessingModeChange(value)
    if (value !== "fast") {
      setIsExpanded(true)
    }
  }

  if (!isExpanded) {
    // Collapsed view - show current mode with expand button
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-foreground">
            Processing Mode
          </label>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            More options
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
        <div className="p-4 rounded-lg border border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <div>
              <div className="text-sm font-medium text-foreground">
                {currentMode?.label}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {currentMode?.description}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Expanded view - show all options
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-foreground">
          Processing Mode
        </label>
        {processingMode === "fast" && (
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Collapse
          </button>
        )}
      </div>
      <RadioGroup
        value={processingMode}
        onValueChange={(value) => handleModeChange(value as ProcessingMode)}
        className="flex flex-col gap-2"
      >
        {MODE_OPTIONS.map((opt) => {
          // Disable "aggressive" for non-PDF/image files or local backend
          const isDisabled =
            opt.value === "aggressive" &&
            (!AGGRESSIVE_MODE_SUPPORTED_TYPES.includes(fileMimeType) ||
              backendMode === "local")

          return (
            <div
              key={opt.value}
              title={
                isDisabled
                  ? backendMode === "local"
                    ? "Aggressive mode requires cloud GPU (CHANDRA needs >16GB VRAM)"
                    : "Aggressive mode is only needed for PDFs and images (uses OCR)"
                  : undefined
              }
              className={cn(isDisabled && "opacity-50")}
            >
              <FieldLabel htmlFor={opt.value}>
                <Field
                  orientation="horizontal"
                  className={cn(
                    "p-4",
                    isDisabled ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <FieldContent>
                    <FieldTitle>{opt.label}</FieldTitle>
                    <FieldDescription>{opt.description}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem
                    value={opt.value}
                    id={opt.value}
                    disabled={isDisabled}
                  />
                </Field>
              </FieldLabel>
            </div>
          )
        })}
      </RadioGroup>
    </div>
  )
}

export function ConfigureProcessingPage({
  fileName,
  fileMimeType,
  pageCount,
  uploadProgress,
  uploadComplete,
  backendMode,
  processingMode,
  useLlm,
  pageRange,
  error,
  isProcessing,
  isCancelling,
  stages,
  onProcessingModeChange,
  onUseLlmChange,
  onPageRangeChange,
  onStartConversion,
  onCancel,
  onBack,
}: Props) {
  const { user } = useAppConfig()
  const currentStep: Step = isProcessing ? "convert" : "configure"

  return (
    <div className="min-h-screen flex flex-col p-6 px-5 bg-background">
      <div className="flex items-center gap-2 text-base font-medium text-muted-foreground">
        Academic Reader
      </div>

      <main className="flex flex-col items-center justify-center flex-1 pb-16">
        <div className="w-full max-w-210 grid gap-8 grid-cols-[240px_1fr] max-sm:grid-cols-1">
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
                <span className="truncate max-w-45 text-foreground font-medium">
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
                {/* Page Range */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label
                      htmlFor="page-range"
                      className="text-sm font-medium text-foreground"
                    >
                      Page Range{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </label>
                    {pageCount !== undefined && (
                      <span className="text-sm text-muted-foreground">
                        {pageCount} {pageCount === 1 ? "page" : "pages"}
                      </span>
                    )}
                  </div>
                  <Input
                    id="page-range"
                    type="text"
                    className="h-10"
                    placeholder="All pages — or specify: 1-5, 10, 15-20"
                    value={pageRange}
                    onChange={(e) => onPageRangeChange(e.target.value)}
                  />
                </div>

                {/* Processing Mode */}
                <ProcessingModeSelector
                  processingMode={processingMode}
                  onProcessingModeChange={onProcessingModeChange}
                  fileMimeType={fileMimeType}
                  backendMode={backendMode}
                />

                {/* Enhanced Detection - only for fast mode on non-datalab backends */}
                {processingMode === "fast" && backendMode !== "datalab" && (
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
                )}

                {/* Actions */}
                <div className="flex flex-col gap-3 mt-2 items-end">
                  {!user && (
                    <p className="text-xs text-muted-foreground">
                      We require a free account to prevent abuse by bots.
                      You'll be prompted to sign in / sign up.
                    </p>
                  )}
                  <div className="flex gap-3 w-full">
                    <Button variant="outline" onClick={onBack} className="h-10">
                      <ArrowLeft className="w-4 h-4 mr-2" strokeWidth={2} />
                      Back
                    </Button>
                    <Button
                      onClick={onStartConversion}
                      disabled={!uploadComplete}
                      className="flex-1 h-10 primary-animated-gradient text-white border-0 hover:opacity-90"
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
