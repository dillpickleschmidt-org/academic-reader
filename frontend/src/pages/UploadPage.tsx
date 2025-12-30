import { Fragment, useRef, useState } from "react"
import { FileUp, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const SUPPORTED_FORMATS = {
  Documents: "PDF, DOCX, ODT",
  Spreadsheets: "XLSX, ODS",
  Presentations: "PPTX, ODP",
  "Web & Books": "HTML, EPUB",
  Images: "PNG, JPG, WEBP, GIF, TIFF",
}

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "text/html",
  "application/epub+zip",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/tiff",
].join(",")

interface Props {
  url: string
  error: string
  onUrlChange: (url: string) => void
  onFileSelect: (file: File) => void
  onFetchUrl: () => void
}

export function UploadPage({
  url,
  error,
  onUrlChange,
  onFileSelect,
  onFetchUrl,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) {
      onFileSelect(dropped)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      onFileSelect(selected)
    }
  }

  return (
    <div className="min-h-screen flex flex-col p-6 px-5 bg-background">
      <div className="flex items-center gap-2 text-base font-medium text-muted-foreground">
        Academic Reader
      </div>

      <main className="flex flex-col items-center justify-center flex-1 pb-16">
        <div className="w-full max-w-[825px] flex flex-col gap-8">
          <div
            className={cn(
              "bg-transparent border-[1.5px] border-dashed border-muted-foreground/40 rounded-xl",
              "py-16 px-12 grid grid-cols-[1fr_auto] gap-8 items-center",
              "cursor-pointer transition-[border-color,background] duration-150",
              "hover:border-muted-foreground/60",
              "max-sm:grid-cols-1 max-sm:text-center max-sm:py-8 max-sm:px-5",
              isDragging && "border-primary bg-primary/5 dark:bg-primary/10",
            )}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileChange}
              hidden
            />

            <div className="text-center py-3">
              <div className="w-16 h-16 mx-auto mb-4 text-muted-foreground">
                <FileUp className="w-full h-full" strokeWidth={1.375} />
              </div>

              <p className="text-xl font-medium text-foreground mb-2">
                Drag and drop your document here
              </p>
              <p className="text-sm text-muted-foreground">
                or{" "}
                <span className="underline cursor-pointer hover:text-foreground">
                  click to browse
                </span>
              </p>
            </div>

            <div
              className={cn(
                "py-3 pl-10 border-l border-border",
                "max-sm:pl-0 max-sm:pt-6 max-sm:border-l-0 max-sm:border-t",
              )}
            >
              <div className="text-[0.95rem] font-medium text-foreground mb-3">
                Supported formats
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-y-1 gap-x-4 text-xs">
                {Object.entries(SUPPORTED_FORMATS).map(
                  ([category, formats]) => (
                    <Fragment key={category}>
                      <span className="font-medium text-[0.85rem] text-muted-foreground">
                        {category}
                      </span>
                      <span className="text-muted-foreground text-[0.75rem]">
                        {formats}
                      </span>
                    </Fragment>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center gap-3 mb-4">
              <Separator className="flex-1" />
              <span className="text-sm text-muted-foreground">OR</span>
              <Separator className="flex-1" />
            </div>

            <div className="flex gap-3 max-sm:flex-col">
              <Input
                type="url"
                className="flex-1 h-11 px-4 text-sm"
                placeholder="Enter a file URL (e.g., https://example.com/document.pdf)"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && url.trim() && onFetchUrl()
                }
              />
              <Button
                variant="outline"
                className="shrink-0 h-11"
                onClick={onFetchUrl}
                disabled={!url.trim()}
              >
                Use URL
              </Button>
            </div>
          </div>

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
