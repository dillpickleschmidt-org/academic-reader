import { Fragment, useRef, useState } from "react"
import { FileUp, AlertCircle } from "lucide-react"
import { cn } from "@repo/core/lib/utils"

const SUPPORTED_FORMATS = {
  Documents: "PDF, DOCX, ODT",
  Spreadsheets: "XLSX, ODS",
  Presentations: "PPTX, ODP",
  "Web & Books": "HTML, EPUB",
  Images: "PNG, JPG, WEBP, GIF, TIFF",
}

const ACCEPTED_MIME_TYPES = [
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
]

const ACCEPTED_TYPES = ACCEPTED_MIME_TYPES.join(",")
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB

interface Props {
  onFileSelect: (file: File) => void
  className?: string
}

export function UploadZone({ onFileSelect, className }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileError, setFileError] = useState("")

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      return "Unsupported file type. Please select a supported format."
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return "File is too large. Maximum size is 50MB."
    }
    return null
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    setFileError("")
    const dropped = e.dataTransfer.files[0]
    if (dropped) {
      const error = validateFile(dropped)
      if (error) {
        setFileError(error)
        return
      }
      onFileSelect(dropped)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError("")
    const selected = e.target.files?.[0]
    if (selected) {
      const error = validateFile(selected)
      if (error) {
        setFileError(error)
        e.target.value = ""
        return
      }
      onFileSelect(selected)
    }
  }

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload document"
        className={cn(
          "bg-transparent rounded-xl primary-animated",
          "py-9 px-6 grid grid-cols-[1fr_auto] gap-6 items-center",
          "cursor-pointer",
          "hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "max-sm:grid-cols-1 max-sm:text-center max-sm:py-9 max-sm:px-4",
          isDragging && "bg-primary/5 dark:bg-primary/10",
        )}
        style={{
          borderWidth: "1.5px",
          borderStyle: "dashed",
          borderColor: "var(--primary-animated-muted)",
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileChange}
          hidden
        />

        {/* Left: Icon + Text */}
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-2 text-muted-foreground">
            <FileUp className="w-full h-full" strokeWidth={1.375} />
          </div>
          <p className="text-base font-medium text-foreground mb-0.5">
            Drag and drop your document
          </p>
          <p className="text-sm text-muted-foreground">
            or{" "}
            <span className="underline cursor-pointer hover:text-foreground">
              click to browse
            </span>
          </p>
        </div>

        {/* Right: Supported Formats */}
        <div
          className={cn(
            "pl-6 border-l border-border",
            "max-sm:pl-0 max-sm:pt-4 max-sm:border-l-0 max-sm:border-t",
          )}
        >
          <div className="text-xs font-medium text-foreground mb-2">
            Supported formats
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-y-0.5 gap-x-3 text-xs">
            {Object.entries(SUPPORTED_FORMATS).map(([category, formats]) => (
              <Fragment key={category}>
                <span className="font-medium text-muted-foreground">
                  {category}
                </span>
                <span className="text-muted-foreground/70">{formats}</span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {fileError && (
        <div className="flex items-center gap-2 mt-3 py-2 px-3 bg-destructive/10 rounded-md text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          <span>{fileError}</span>
        </div>
      )}
    </div>
  )
}
