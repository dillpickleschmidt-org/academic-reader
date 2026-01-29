import {
  FileText,
  Zap,
  Sparkles,
  FileOutput,
  Volume2,
  LayoutGrid,
  Code,
  Loader2,
  X,
} from "lucide-react"
import { Button } from "@repo/core/ui/primitives/button"
import { useAppConfig } from "@/hooks/use-app-config"
import { authClient } from "@repo/convex/auth-client"
import { AuthDialog } from "@/components/AuthDialog"
import { UploadZone } from "@/components/UploadZone"

interface RecentDocument {
  _id: string
  filename: string
}

interface Props {
  onFileSelect: (file: File) => void
  recentDocuments?: RecentDocument[]
  onViewDocument?: (documentId: string) => void
  onDeleteDocument?: (documentId: string) => void
}

const FEATURES = [
  {
    icon: FileText,
    title: "Accurate document conversion",
    description: "Every word, figure, and table preserved with full fidelity",
  },
  {
    icon: FileOutput,
    title: "Scans transformed",
    description:
      "Book scans and images become digital, searchable documents with jumplinks to citations, tables, and figures",
  },
  {
    icon: Volume2,
    title: "Natural narration",
    description:
      "High-quality voices that skip citations and read equations naturally (or skip them)",
  },
  {
    icon: Sparkles,
    title: "Math made clear (coming soon)",
    description:
      "Select any confusing equation for a plain-language explanation",
  },
  {
    icon: Zap,
    title: "AI that follows references (coming soon)",
    description:
      "When a paper says 'outlined in Section 4.1(b)', your chat actually follows the reference",
  },
  {
    icon: LayoutGrid,
    title: "Focus-friendly ambience",
    description:
      "Rain, fireplace, brown noise, and curated music to help you concentrate",
  },
]

export function LandingPage({
  onFileSelect,
  recentDocuments,
  onViewDocument,
  onDeleteDocument,
}: Props) {
  const { user } = useAppConfig()

  return (
    <div className="min-h-screen flex flex-col p-6 px-5 bg-background">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-medium text-muted-foreground">
          Academic Reader
        </div>
        {user ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => authClient.signOut()}
          >
            Logout
          </Button>
        ) : (
          <AuthDialog />
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center pt-6 sm:pt-8 lg:pt-16 pb-16">
        <div className="w-full max-w-2xl mx-auto flex flex-col items-center">
          {/* Hero */}
          <h1
            className="text-4xl sm:text-5xl font-bold primary-animated-text text-center leading-none"
            style={{
              background: "linear-gradient(to right, var(--primary-animated), var(--primary-animated-end))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Papers that read like articles.
          </h1>
          <p className="text-foreground/90 text-center mt-4 text-lg max-w-lg">
            All the content, none of the friction. Comfortable formatting plus
            clean text-to-speech that skips the noise.
          </p>

          {/* Upload Zone */}
          <div className="w-full mt-10">
            <UploadZone onFileSelect={onFileSelect} />
          </div>

          {/* Feature List */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 w-full">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex items-start gap-3">
                <feature.icon
                  className="w-5 h-5 mt-0.5 shrink-0 primary-animated"
                  style={{ color: "var(--primary-animated)" }}
                  strokeWidth={1.5}
                />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {feature.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {feature.description}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Recent Documents (for logged-in users) */}
          {user && onViewDocument && recentDocuments === undefined && (
            <div className="mt-10 w-full">
              <div className="text-sm text-muted-foreground mb-3">
                Recently Viewed
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading...</span>
              </div>
            </div>
          )}

          {user &&
            onViewDocument &&
            recentDocuments &&
            recentDocuments.length > 0 && (
              <div className="mt-10 w-full">
                <div className="text-sm text-muted-foreground mb-3">
                  Recently Viewed
                </div>
                <div className="flex flex-col gap-2">
                  {recentDocuments.map((doc) => (
                    <div
                      key={doc._id}
                      className="flex items-center gap-2 py-2 px-3 rounded-lg border border-border bg-card"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        disabled
                        title="PDF viewing coming soon"
                      >
                        <FileText className="w-4 h-4" strokeWidth={1.5} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        onClick={() => onViewDocument(doc._id)}
                        title="View HTML"
                      >
                        <Code className="w-4 h-4" strokeWidth={1.5} />
                      </Button>
                      <span
                        className="text-sm text-foreground truncate"
                        style={{ maxWidth: "20ch" }}
                        title={doc.filename}
                      >
                        {doc.filename}
                      </span>
                      {onDeleteDocument && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 ml-auto text-muted-foreground hover:text-destructive"
                          onClick={() => onDeleteDocument(doc._id)}
                          title="Remove"
                        >
                          <X className="w-4 h-4" strokeWidth={1.5} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
      </main>
    </div>
  )
}
