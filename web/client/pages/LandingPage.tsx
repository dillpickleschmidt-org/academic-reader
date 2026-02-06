import { useEffect, useRef, useState } from "react"
import { Loader2, X, FileText, Code } from "lucide-react"
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
    title: "Accurate document conversion",
    description: "Every word, figure, and table preserved with full fidelity",
    icon: "document" as const,
  },
  {
    title: "Scans transformed",
    description:
      "Book scans and images become digital, searchable documents with jumplinks to citations, tables, and figures",
    icon: "scan" as const,
  },
  {
    title: "Natural narration",
    description:
      "High-quality voices that skip citations and read equations naturally (or skip them)",
    icon: "narration" as const,
  },
  {
    title: "Math made clear",
    comingSoon: true,
    description:
      "Select any confusing equation for a plain-language explanation",
    icon: "math" as const,
  },
  {
    title: "AI that follows references",
    comingSoon: true,
    description:
      "When a paper says 'outlined in Section 4.1(b)', your chat actually follows the reference",
    icon: "reference" as const,
  },
  {
    title: "Focus-friendly ambience",
    description:
      "Rain, fireplace, brown noise, and curated music to help you concentrate",
    icon: "ambience" as const,
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
    <div className="landing-theme min-h-screen flex flex-col antialiased bg-background text-foreground font-sans overflow-hidden">
      <Header user={user} />

      <main className="flex-1">
        <HeroSection onFileSelect={onFileSelect} />
        <FeaturesSection />
        {user && onViewDocument && (
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

function Header({ user }: { user: unknown }) {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
      <div className="flex items-center gap-2.5">
        <LeafLogo />
        <span className="text-lg tracking-tight text-foreground font-serif font-bold">
          Academic Reader
        </span>
      </div>
      {user ? (
        <Button variant="ghost" size="sm" onClick={() => authClient.signOut()}>
          Logout
        </Button>
      ) : (
        <AuthDialog />
      )}
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
            filter: "blur(80px)",
            background:
              "radial-gradient(ellipse at center, var(--blob-1) 0%, transparent 70%)",
            animation: "hero-breathe 8s ease-in-out infinite",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: 400,
            height: 400,
            bottom: -60,
            left: "30%",
            filter: "blur(90px)",
            background:
              "radial-gradient(ellipse at center, var(--blob-2) 0%, transparent 70%)",
            animation: "hero-breathe 8s ease-in-out infinite 4s",
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
          All the content, none of the friction. Comfortable formatting plus
          clean text-to-speech that skips the noise.
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

function FeaturesSection() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <section className="py-12 sm:py-20" ref={sectionRef}>
      <div className="max-w-4xl mx-auto px-6 sm:px-10">
        <div className="text-center mb-12 mx-auto max-w-2xl">
          <h2
            className="leading-tight text-foreground font-serif font-bold"
            style={{ fontSize: "clamp(1.5rem, 3vw, 2.25rem)" }}
          >
            Everything you need to <em style={{ fontWeight: 400 }}>finally</em>{" "}
            understand that paper
          </h2>
          <p
            className="mt-3 max-w-lg mx-auto text-base text-muted-foreground"
            style={{ fontWeight: 300 }}
          >
            We handle the formatting headaches so you can focus on the ideas.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {FEATURES.map((feature, i) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              index={i}
              isVisible={isVisible}
              wide={i === 0}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({
  feature,
  index,
  isVisible,
  wide,
}: {
  feature: (typeof FEATURES)[number]
  index: number
  isVisible: boolean
  wide: boolean
}) {
  const [svgAnimated, setSvgAnimated] = useState(false)

  useEffect(() => {
    if (!isVisible) return
    const timer = setTimeout(() => setSvgAnimated(true), index * 120)
    return () => clearTimeout(timer)
  }, [isVisible, index])

  return (
    <div
      className={`
        rounded-2xl p-7 relative overflow-hidden transition-all duration-300 ease-out
        hover:-translate-y-0.5 bg-card border border-border shadow-sm
        ${wide ? "sm:col-span-2 sm:flex sm:gap-6 sm:items-start" : ""}
        ${isVisible ? "" : "opacity-0"}
      `}
      style={
        isVisible
          ? {
              animation: `fade-in-up 0.6s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.1}s forwards`,
            }
          : undefined
      }
    >
      <div
        className={`w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-primary/8 text-primary ${wide ? "sm:mb-0 mb-4" : "mb-4"}`}
      >
        <BotanicalIcon type={feature.icon} animated={svgAnimated} />
      </div>
      <div>
        <div className="text-[1.05rem] leading-snug mb-2 text-foreground font-serif font-bold">
          {feature.title}
          {feature.comingSoon && (
            <span className="inline-block text-[0.65rem] font-sans font-medium uppercase tracking-wide align-middle ml-2 py-0.5 px-2 rounded-md text-[#c17f59] dark:text-[#c4a265] bg-[#c17f5912] dark:bg-[rgba(196,162,101,0.07)] border border-[#c17f5930] dark:border-[rgba(196,162,101,0.19)]">
              coming soon
            </span>
          )}
        </div>
        <div
          className="text-sm leading-relaxed text-foreground/75"
          style={{ fontWeight: 300 }}
        >
          {feature.description}
        </div>
      </div>
    </div>
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
                    className="h-8 w-8 p-0 ml-auto text-muted-foreground hover:text-[#c17f59] dark:hover:text-[#c4a265] hover:bg-accent"
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

function BotanicalIcon({
  type,
  animated,
}: {
  type: string
  animated: boolean
}) {
  const cls = `botanical-svg ${animated ? "animate" : ""}`

  switch (type) {
    case "document":
      return (
        <svg
          className={cls}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--path-length": 120 } as React.CSSProperties}
        >
          <path d="M4 6C4 6 8 2 12 6C16 2 20 6 20 6" />
          <path d="M4 6V20H20V6" />
          <path d="M8 11H16" />
          <path d="M8 15H14" />
          <path d="M12 6V2" />
        </svg>
      )
    case "scan":
      return (
        <svg
          className={cls}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--path-length": 150 } as React.CSSProperties}
        >
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <path d="M7 12C7 9 9 7 12 7C15 7 17 9 17 12C17 15 15 17 12 17C9 17 7 15 7 12Z" />
          <circle cx="12" cy="12" r="1" />
        </svg>
      )
    case "narration":
      return (
        <svg
          className={cls}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--path-length": 140 } as React.CSSProperties}
        >
          <path d="M12 18C12 18 8 16 8 12V7L12 5L16 7V12C16 16 12 18 12 18Z" />
          <path d="M12 5V2" />
          <path d="M9 10.5C9 10.5 10 12 12 12C14 12 15 10.5 15 10.5" />
          <path d="M4 14C2.5 12 2.5 9 4 7" />
          <path d="M20 14C21.5 12 21.5 9 20 7" />
        </svg>
      )
    case "math":
      return (
        <svg
          className={cls}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--path-length": 120 } as React.CSSProperties}
        >
          <path d="M4 4C4 4 8 8 12 4C16 8 20 4 20 4" />
          <path d="M7 12L10 9L13 15L17 12" />
          <path d="M4 20C4 20 8 16 12 20C16 16 20 20 20 20" />
        </svg>
      )
    case "reference":
      return (
        <svg
          className={cls}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--path-length": 160 } as React.CSSProperties}
        >
          <path d="M8 3C5 3 3 5 3 8C3 11 5 13 8 13" />
          <path d="M16 3C19 3 21 5 21 8C21 11 19 13 16 13" />
          <path d="M8 13L8 17L12 21L16 17L16 13" />
          <path d="M12 13V21" />
          <path d="M10 8H14" />
        </svg>
      )
    case "ambience":
      return (
        <svg
          className={cls}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--path-length": 180 } as React.CSSProperties}
        >
          <path d="M12 3C12 3 8 7 8 12C8 17 12 21 12 21" />
          <path d="M12 3C12 3 16 7 16 12C16 17 12 21 12 21" />
          <path d="M5 8C7 10 7 14 5 16" />
          <path d="M19 8C17 10 17 14 19 16" />
          <path d="M3 12H5" />
          <path d="M19 12H21" />
        </svg>
      )
    default:
      return null
  }
}
