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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { OutputFormat } from "../hooks/useConversion"

interface Props {
  fileName: string
  uploadProgress: number
  uploadComplete: boolean
  outputFormat: OutputFormat
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
  error: string
  onOutputFormatChange: (format: OutputFormat) => void
  onUseLlmChange: (value: boolean) => void
  onForceOcrChange: (value: boolean) => void
  onPageRangeChange: (value: string) => void
  onStartConversion: () => void
  onBack: () => void
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
]

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
    <div className="min-h-screen flex flex-col p-6 px-5 bg-background">
      <div className="flex items-center gap-2 text-base font-medium text-muted-foreground">
        Academic Reader
      </div>

      <main className="flex flex-col items-center justify-center flex-1 pb-16">
        <div className="w-full max-w-[640px] flex flex-col gap-4">
          {/* File Card */}
          <Card className="bg-secondary/50 border-border">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-muted rounded-md flex items-center justify-center text-muted-foreground">
                  <FileText className="w-5 h-5" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="block font-medium text-sm text-foreground truncate">
                    {fileName}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500 mt-0.5">
                    {uploadComplete ? (
                      <>
                        <Check className="w-3.5 h-3.5" strokeWidth={2} />
                        Ready to convert
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        Uploading... {uploadProgress}%
                      </span>
                    )}
                  </span>
                </div>
              </div>
              {!uploadComplete && (
                <div className="h-0.5 bg-muted rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Output Format */}
          <Card className="bg-secondary/50 border-border">
            <CardHeader className="p-5 pb-0">
              <CardTitle className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Output Format
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-3">
              <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                {FORMAT_OPTIONS.map((format) => (
                  <button
                    key={format.value}
                    className={cn(
                      "flex flex-col items-center gap-1 py-3.5 px-2",
                      "bg-muted rounded-md border border-transparent",
                      "cursor-pointer transition-[border-color,background] duration-150",
                      "hover:border-border",
                      outputFormat === format.value &&
                        "border-primary bg-background",
                    )}
                    onClick={() => onOutputFormatChange(format.value)}
                  >
                    <div
                      className={cn(
                        "w-5 h-5 text-muted-foreground",
                        outputFormat === format.value && "text-primary",
                      )}
                    >
                      {format.icon}
                    </div>
                    <div className="font-medium text-sm text-foreground">
                      {format.label}
                    </div>
                    <div className="text-[0.65rem] text-muted-foreground text-center">
                      {format.description}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Processing Options */}
          <Card className="bg-secondary/50 border-border">
            <CardHeader className="p-5 pb-0">
              <CardTitle className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Processing Options
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-3">
              <div className="flex flex-col gap-2">
                {/* AI Enhancement Toggle */}
                <label
                  className={cn(
                    "flex items-center justify-between p-3",
                    "bg-muted rounded-md border border-transparent",
                    "cursor-pointer transition-[border-color] duration-150",
                    "hover:border-border",
                    useLlm && "border-primary",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-8 h-8 rounded flex items-center justify-center transition-colors duration-150",
                        useLlm
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground",
                      )}
                    >
                      <Sparkles className="w-4 h-4" strokeWidth={1.5} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm text-foreground">
                        AI Enhancement
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Better for tables & equations
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "relative w-10 h-6 rounded-full transition-colors duration-150",
                      useLlm ? "bg-primary" : "bg-border",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="opacity-0 w-0 h-0"
                      checked={useLlm}
                      onChange={(e) => onUseLlmChange(e.target.checked)}
                    />
                    <span
                      className={cn(
                        "absolute w-[18px] h-[18px] bg-white rounded-full top-[3px] left-[3px]",
                        "transition-transform duration-150",
                        useLlm && "translate-x-4",
                      )}
                    />
                  </div>
                </label>

                {/* Force OCR Toggle */}
                <label
                  className={cn(
                    "flex items-center justify-between p-3",
                    "bg-muted rounded-md border border-transparent",
                    "cursor-pointer transition-[border-color] duration-150",
                    "hover:border-border",
                    forceOcr && "border-primary",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-8 h-8 rounded flex items-center justify-center transition-colors duration-150",
                        forceOcr
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground",
                      )}
                    >
                      <ScanLine className="w-4 h-4" strokeWidth={1.5} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm text-foreground">
                        Force OCR
                      </span>
                      <span className="text-xs text-muted-foreground">
                        For scanned documents
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "relative w-10 h-6 rounded-full transition-colors duration-150",
                      forceOcr ? "bg-primary" : "bg-border",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="opacity-0 w-0 h-0"
                      checked={forceOcr}
                      onChange={(e) => onForceOcrChange(e.target.checked)}
                    />
                    <span
                      className={cn(
                        "absolute w-[18px] h-[18px] bg-white rounded-full top-[3px] left-[3px]",
                        "transition-transform duration-150",
                        forceOcr && "translate-x-4",
                      )}
                    />
                  </div>
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Page Range */}
          <Card className="bg-secondary/50 border-border">
            <CardHeader className="p-5 pb-0">
              <CardTitle className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Page Range
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-3">
              <Input
                type="text"
                className="h-10"
                placeholder="All pages (or specify: 1-5, 10, 15-20)"
                value={pageRange}
                onChange={(e) => onPageRangeChange(e.target.value)}
              />
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-1 max-sm:flex-col">
            <Button
              variant="outline"
              onClick={onBack}
              className="shrink-0 max-sm:w-full"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" strokeWidth={2} />
              Back
            </Button>
            <Button
              onClick={onStartConversion}
              disabled={!uploadComplete}
              className="flex-1 max-sm:w-full"
            >
              {uploadComplete ? (
                <>
                  <ArrowRight className="w-4 h-4 mr-1.5" strokeWidth={2} />
                  Convert
                </>
              ) : (
                <>
                  <Loader2
                    className="w-4 h-4 mr-1.5 animate-spin"
                    strokeWidth={2}
                  />
                  Uploading...
                </>
              )}
            </Button>
          </div>

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
        </div>
      </main>
    </div>
  )
}
