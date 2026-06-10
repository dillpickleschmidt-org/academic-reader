import { useState } from "react"
import {
  FileText,
  Check,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Sparkles,
  ScanText,
  ChevronDown,
} from "lucide-react"
import { cn } from "@academic-reader/ui/utils"
import { Button } from "@academic-reader/ui/primitives/button"
import { Input } from "@academic-reader/ui/primitives/input"
import { Switch } from "@academic-reader/ui/primitives/switch"
import {
  RadioGroup,
  RadioGroupItem,
} from "@academic-reader/ui/primitives/radio-group"
import {
  Field,
  FieldLabel,
  FieldContent,
  FieldTitle,
  FieldDescription,
} from "@academic-reader/ui/primitives/field"
import { InfoTooltip } from "@/components/InfoTooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@academic-reader/ui/primitives/select"
import { VOICES } from "@academic-reader/api-client/schemas/tts"
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import type { BackendType } from "@academic-reader/api-client/schemas/common"
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
      "Has good spacial understanding - results in better image crops and multi-span table columns.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description:
      "Better text capture, but not great spacial understanding (images not perfectly cropped). Your mileage may vary.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    description:
      "Slower and more agressive at converting diagrams to plain text instead of images. Your mileage may vary.",
  },
]

interface Props {
  fileName: string
  fileMimeType: string
  pageCount: number | null
  uploadProgress: number
  uploadComplete: boolean
  conversionBackend: BackendType
  processingModes: ProcessingMode[]
  ttsEnabled: boolean
  processingMode: ProcessingMode
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
  narratorVoice: string
  error: string
  isProcessing: boolean
  onProcessingModeChange: (mode: ProcessingMode) => void
  onUseLlmChange: (value: boolean) => void
  onForceOcrChange: (value: boolean) => void
  onPageRangeChange: (value: string) => void
  onNarratorVoiceChange: (value: string) => void
  onStartConversion: () => void
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

function ProcessingModeSelector({
  processingMode,
  onProcessingModeChange,
  fileMimeType,
  processingModes,
}: {
  processingMode: ProcessingMode
  onProcessingModeChange: (mode: ProcessingMode) => void
  fileMimeType: string
  processingModes: ProcessingMode[]
}) {
  const [isExpanded, setIsExpanded] = useState(processingMode !== "fast")
  const currentMode = MODE_OPTIONS.find((m) => m.value === processingMode)

  const handleModeChange = (value: ProcessingMode) => {
    onProcessingModeChange(value)
    if (value !== "fast") {
      setIsExpanded(true)
    }
  }

  if (!isExpanded) {
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
          const isDisabled =
            !processingModes.includes(opt.value) ||
            (opt.value === "aggressive" &&
              !AGGRESSIVE_MODE_SUPPORTED_TYPES.includes(fileMimeType))

          return (
            <div
              key={opt.value}
              title={
                isDisabled
                  ? !processingModes.includes(opt.value)
                    ? "This processing mode is not configured"
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
  conversionBackend,
  processingModes,
  ttsEnabled,
  processingMode,
  useLlm,
  forceOcr,
  pageRange,
  narratorVoice,
  error,
  isProcessing,
  onProcessingModeChange,
  onUseLlmChange,
  onForceOcrChange,
  onPageRangeChange,
  onNarratorVoiceChange,
  onStartConversion,
  onBack,
}: Props) {
  const { user, isLoading: appConfigLoading } = useAppConfig()
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
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                Creating document...
              </div>
            ) : (
              <>
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
                    {pageCount !== null && (
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

                <ProcessingModeSelector
                  processingMode={processingMode}
                  onProcessingModeChange={onProcessingModeChange}
                  fileMimeType={fileMimeType}
                  processingModes={processingModes}
                />

                {ttsEnabled && (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-foreground">
                      Narrator
                    </label>
                    <Select
                      value={narratorVoice}
                      onValueChange={(value) =>
                        value && onNarratorVoiceChange(value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {VOICES.find((voice) => voice.id === narratorVoice)
                            ?.displayName ?? "Narrator"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {VOICES.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {processingMode === "fast" && (
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center bg-muted text-muted-foreground">
                        <ScanText className="w-4 h-4" strokeWidth={1.5} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          Force OCR
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Re-OCR all pages, even those with extractable text
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={forceOcr}
                      onCheckedChange={onForceOcrChange}
                    />
                  </div>
                )}

                {processingMode === "fast" && conversionBackend !== "datalab" && (
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

                <div className="flex flex-col gap-3 mt-2 items-end">
                  {!appConfigLoading && !user && (
                    <p className="text-xs text-muted-foreground">
                      We require a free account to prevent abuse by bots. You'll
                      be prompted to sign in / sign up.
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
                      className="flex-1 h-10 bg-gradient-to-r from-[var(--primary)] to-[var(--primary-end)] text-white border-0 hover:opacity-90"
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
