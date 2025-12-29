import { Fragment, useRef, useState } from "react";
import { FileUp } from "lucide-react";

const SUPPORTED_FORMATS = {
  Documents: "PDF, DOCX, ODT",
  Spreadsheets: "XLSX, ODS",
  Presentations: "PPTX, ODP",
  "Web & Books": "HTML, EPUB",
  Images: "PNG, JPG, WEBP, GIF, TIFF",
};

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
].join(",");

interface Props {
  url: string;
  error: string;
  onUrlChange: (url: string) => void;
  onFileSelect: (file: File) => void;
  onFetchUrl: () => void;
}

export function UploadPage({
  url,
  error,
  onUrlChange,
  onFileSelect,
  onFetchUrl,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      onFileSelect(dropped);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      onFileSelect(selected);
    }
  };

  return (
    <div className="app-page">
      <div className="app-page-header">Academic Reader</div>

      <main className="app-page-main">
        <div className="upload-content">
          <div
            className={`upload-zone ${isDragging ? "dragging" : ""}`}
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

            <div className="upload-droparea">
              <div className="upload-icon">
                <FileUp strokeWidth={1.375} />
              </div>

              <p className="upload-title">Drag and drop your document here</p>
              <p className="upload-subtitle">
                or <a>click to browse</a>
              </p>
            </div>

            <div className="supported-formats">
              <div className="supported-formats-title">Supported formats</div>
              <div className="supported-formats-list">
                {Object.entries(SUPPORTED_FORMATS).map(
                  ([category, formats]) => (
                    <Fragment key={category}>
                      <span className="format-category">{category}</span>
                      <span className="format-list">{formats}</span>
                    </Fragment>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="url-section">
            <div className="divider">
              <span>OR</span>
            </div>

            <div className="url-form">
              <input
                type="url"
                className="url-input"
                placeholder="Enter a file URL (e.g., https://example.com/document.pdf)"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && url.trim() && onFetchUrl()
                }
              />
              <button
                className="btn btn-secondary"
                onClick={onFetchUrl}
                disabled={!url.trim()}
              >
                Use URL
              </button>
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4m0 4h.01"
                />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
