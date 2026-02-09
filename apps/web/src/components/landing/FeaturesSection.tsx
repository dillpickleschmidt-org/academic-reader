import { useEffect, useRef, useState } from "react"
import { ConversionDemo } from "./demos/ConversionDemo"
import { PhoneFriendlyDemo } from "./demos/PhoneFriendlyDemo"
import { ScanDemo } from "./demos/ScanDemo"
import { NarrationDemo } from "./demos/NarrationDemo"
import { MathDemo } from "./demos/MathDemo"
import { ReferenceDemo } from "./demos/ReferenceDemo"
import { AmbienceDemo } from "./demos/AmbienceDemo"

const FEATURES = [
  {
    title: "Accurate document conversion",
    description: "Every word, figure, and table preserved with full fidelity",
    comingSoon: false,
  },
  {
    title: "Scans transformed",
    description:
      "Book scans and images become digital, searchable documents with jumplinks to citations, tables, and figures",
    comingSoon: false,
  },
  {
    title: "Natural narration",
    description:
      "High-quality voices that skip citations and read equations naturally (or skip them)",
    comingSoon: false,
  },
  {
    title: "Papers... on your phone?",
    description:
      "Dense two-column layouts become clean, single-column text you can comfortably read on any screen",
    comingSoon: false,
  },
  {
    title: "Math made clear",
    description:
      "Select any confusing equation for a plain-language explanation",
    comingSoon: true,
  },
  {
    title: "AI that follows references",
    description:
      "When a paper says 'outlined in Section 4.1(b)', your chat actually follows the reference",
    comingSoon: true,
  },
  {
    title: "Focus-friendly ambience",
    description:
      "Rain, fireplace, brown noise, and curated music to help you concentrate",
    comingSoon: false,
  },
]

const DEMOS = [
  ConversionDemo,
  ScanDemo,
  NarrationDemo,
  PhoneFriendlyDemo,
  MathDemo,
  ReferenceDemo,
  AmbienceDemo,
]

export function FeaturesSection() {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { threshold: 0.05 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <section className="py-16 sm:py-24" ref={ref}>
      <div className="max-w-5xl mx-auto px-6 sm:px-10">
        <div className="text-center mb-4 mx-auto max-w-2xl">
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

        <div className="relative">
          {/* Vertical connecting line (desktop) */}
          <div className="hidden sm:block absolute left-1/2 top-4 bottom-4 w-px bg-border -translate-x-px" />

          <div className="space-y-10 sm:space-y-0">
            {FEATURES.map((f, i) => {
              const reversed = i % 2 === 1
              const Demo = DEMOS[i]
              return (
                <div
                  key={f.title}
                  className={`
                    relative sm:grid sm:grid-cols-2 sm:gap-10 sm:py-6
                    ${visible ? "" : "opacity-0"}
                  `}
                  style={
                    visible
                      ? {
                          animation: `fade-in-up 0.6s ease-out ${i * 0.1}s both`,
                        }
                      : undefined
                  }
                >
                  {/* Center dot (desktop) */}
                  <div className="hidden sm:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary/30 border-2 border-card" />
                  </div>

                  {/* Text panel */}
                  <div
                    className={`${reversed ? "sm:text-right" : "sm:order-2"} flex flex-col justify-center sm:px-4`}
                  >
                    <span
                      className="text-2xl sm:text-5xl font-serif text-muted-foreground/20 leading-none mb-3"
                      style={{ fontWeight: 300 }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-lg sm:text-xl leading-snug mb-2 font-serif font-bold text-foreground">
                      {f.title}
                      {f.comingSoon && <ComingSoonBadge />}
                    </h3>
                    <p
                      className="text-sm sm:text-base leading-relaxed text-foreground/70 max-w-sm"
                      style={{
                        fontWeight: 300,
                        marginLeft: reversed ? "auto" : undefined,
                      }}
                    >
                      {f.description}
                    </p>
                  </div>

                  {/* Demo panel */}
                  <div className="mt-5 sm:mt-0">
                    <div className="bg-card rounded-2xl border border-border p-6 sm:p-8 shadow-sm">
                      <Demo />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function ComingSoonBadge() {
  return (
    <span className="inline-block text-[0.65rem] font-sans font-medium uppercase tracking-wide align-middle ml-2 py-0.5 px-2 rounded-md text-[#c17f59] dark:text-[#c4a265] bg-[#c17f5912] dark:bg-[rgba(196,162,101,0.07)] border border-[#c17f5930] dark:border-[rgba(196,162,101,0.19)]">
      coming soon
    </span>
  )
}
