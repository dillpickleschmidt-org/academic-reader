import { Loader2, X, FileText, Code } from "lucide-react"
import { Button } from "@academic-reader/ui/primitives/button"
import { useAppConfig } from "@/hooks/use-app-config"
import { authClient } from "@academic-reader/convex/auth-client"
import { AuthDialog } from "@/components/AuthDialog"
import { UploadZone } from "@/components/UploadZone"
import { FeaturesSection } from "@/components/landing/FeaturesSection"

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

export function LandingPage({
  onFileSelect,
  recentDocuments,
  onViewDocument,
  onDeleteDocument,
}: Props) {
  const { user, isLoading } = useAppConfig()

  return (
    <div className="landing-theme min-h-screen flex flex-col antialiased bg-background text-foreground font-sans overflow-hidden">
      <Header user={user} isLoading={isLoading} />

      <main className="flex-1">
        <HeroSection onFileSelect={onFileSelect} />
        <FeaturesSection />
        {!isLoading && user && onViewDocument && (
          <RecentDocumentsSection
            recentDocuments={recentDocuments}
            onViewDocument={onViewDocument}
            onDeleteDocument={onDeleteDocument}
          />
        )}
      </main>

      <footer className="text-center text-sm py-8 px-6 border-t border-border text-muted-foreground">
        Academic Reader
      </footer>
    </div>
  )
}

function Header({
  user,
  isLoading,
}: {
  user: unknown
  isLoading: boolean
}) {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
      <div className="flex items-center gap-2.5">
        <LeafLogo />
        <span className="text-lg tracking-tight text-foreground font-serif font-bold">
          Academic Reader
        </span>
      </div>
      <div className="flex items-center gap-2">
        <a
          href="/pricing"
          className="text-sm text-foreground/60 hover:text-foreground transition-colors px-3 py-1.5"
          style={{ fontWeight: 400 }}
        >
          Pricing
        </a>
        {isLoading ? (
          <div className="h-8 w-18 rounded-md bg-muted animate-pulse" />
        ) : user ? (
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
      </div>
    </header>
  )
}

function HeroSection({ onFileSelect }: { onFileSelect: (file: File) => void }) {
  return (
    <section className="relative pt-12 sm:pt-20 lg:pt-28 pb-8 sm:pb-12">
      {/* Watercolor wash blobs */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute rounded-full"
          style={{
            width: 600,
            height: 600,
            top: -120,
            left: -100,
            background:
              "radial-gradient(ellipse at center, var(--blob-1) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: 400,
            height: 400,
            bottom: -60,
            left: "30%",
            background:
              "radial-gradient(ellipse at center, var(--blob-2) 0%, transparent 70%)",
          }}
        />
      </div>

      <div className="relative z-1 max-w-2xl mx-auto px-6 sm:px-10 flex flex-col items-center">
        <h1
          className="text-center leading-[1.1] tracking-tight text-foreground font-serif font-black"
          style={{ fontSize: "clamp(2.25rem, 5vw, 3.5rem)" }}
        >
          {[
            { word: "Papers", accent: false },
            { word: "that", accent: false },
            { word: "read", accent: false },
            { word: "like", accent: true },
            { word: "articles.", accent: true },
          ].map(({ word, accent }, i, arr) => (
            <span key={i}>
              <span
                className="inline-block opacity-0"
                style={{
                  transform: "translateY(40px)",
                  animation: `word-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${0.15 + i * 0.12}s forwards`,
                  color: accent ? "var(--primary)" : undefined,
                }}
              >
                {word}
              </span>
              {i < arr.length - 1 ? " " : ""}
            </span>
          ))}
        </h1>

        <p
          className="text-center mt-5 max-w-lg text-lg leading-relaxed text-foreground/75"
          style={{ fontWeight: 300 }}
        >
          Convert any reading material into a comfortable kindle-like reading
          experience, with additional tools and narration.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2.5 mt-6">
          {["PDF", "PNG", "JPG", "WEBP", "GIF", "TIFF"].map((fmt) => (
            <span
              key={fmt}
              className="inline-flex items-center px-3 py-1 rounded-full text-xs transition-colors bg-card border border-border text-foreground/75"
            >
              {fmt}
            </span>
          ))}
        </div>

        <div className="w-full mt-10">
          <UploadZone onFileSelect={onFileSelect} />
        </div>
      </div>
    </section>
  )
}

function RecentDocumentsSection({
  recentDocuments,
  onViewDocument,
  onDeleteDocument,
}: {
  recentDocuments?: RecentDocument[]
  onViewDocument: (documentId: string) => void
  onDeleteDocument?: (documentId: string) => void
}) {
  if (recentDocuments !== undefined && recentDocuments.length === 0) return null

  return (
    <section className="pb-16 sm:pb-24">
      <div className="max-w-2xl mx-auto px-6 sm:px-10">
        <h3 className="mb-4 text-[1.1rem] text-foreground font-serif font-bold">
          Recently Viewed
        </h3>

        {recentDocuments === undefined && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading your documents...</span>
          </div>
        )}

        {recentDocuments && recentDocuments.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {recentDocuments.map((doc) => (
              <div
                key={doc._id}
                className="flex items-center gap-3 py-3 px-4 rounded-xl transition-colors bg-card border border-border"
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
                  className="text-sm truncate text-foreground"
                  style={{ maxWidth: "20ch" }}
                  title={doc.filename}
                >
                  {doc.filename}
                </span>
                {onDeleteDocument && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 ml-auto text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onDeleteDocument(doc._id)}
                    title="Remove"
                  >
                    <X className="w-4 h-4" strokeWidth={1.5} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function LeafLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 28C8 28 6 18 12 12C18 6 28 4 28 4C28 4 26 14 20 20C14 26 8 28 8 28Z"
        fill="var(--primary)"
        opacity="0.2"
      />
      <path
        d="M8 28C8 28 6 18 12 12C18 6 28 4 28 4C28 4 26 14 20 20C14 26 8 28 8 28Z"
        stroke="var(--primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 14C14.5 17.5 10 22 8 28"
        stroke="var(--primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M15 17L12 14"
        stroke="var(--primary)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M19 13L17 10"
        stroke="var(--primary)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}
