import type { ReactNode } from "react"
import { Check } from "lucide-react"
import { Button } from "@repo/core/ui/primitives/button"

export function PricingPage() {
  return (
    <PageShell>
      <section className="relative pt-16 sm:pt-24 pb-20 sm:pb-32">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
        >
          <div
            className="absolute rounded-full"
            style={{
              width: 500,
              height: 500,
              top: -80,
              right: -100,
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
              bottom: 100,
              left: -50,
              filter: "blur(90px)",
              background:
                "radial-gradient(ellipse at center, var(--blob-2) 0%, transparent 70%)",
              animation: "hero-breathe 8s ease-in-out infinite 4s",
            }}
          />
        </div>

        <div className="relative z-1 max-w-4xl mx-auto px-6 sm:px-10">
          <div className="text-center mb-12 sm:mb-16">
            <h1
              className="text-foreground font-serif font-black leading-tight"
              style={{ fontSize: "clamp(1.75rem, 4vw, 2.75rem)" }}
            >
              Pricing
            </h1>
            <p
              className="mt-4 text-foreground/60 text-lg max-w-md mx-auto"
              style={{ fontWeight: 300 }}
            >
              Every plan includes full access to all features.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5 sm:gap-6 items-start">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl border bg-card p-6 sm:p-7 transition-shadow ${
                  tier.popular
                    ? "border-primary/40 shadow-lg sm:-mt-4 sm:-mb-4"
                    : "border-border shadow-sm"
                }`}
              >
                {tier.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-primary text-white shadow-sm">
                    Most Popular
                  </span>
                )}

                <div className="mb-5">
                  <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    {tier.name}
                  </h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-4xl font-serif font-black text-foreground">
                      {tier.price}
                    </span>
                    {tier.period && (
                      <span className="text-muted-foreground text-sm">
                        {tier.period}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-2 text-sm text-foreground/60"
                    style={{ fontWeight: 300 }}
                  >
                    {tier.description}
                  </p>
                </div>

                <div className="h-px bg-border mb-5" />

                <ul className="space-y-3 mb-6">
                  {tier.limits.map((limit) => (
                    <li
                      key={limit}
                      className="flex items-start gap-2.5 text-sm text-foreground"
                    >
                      <Check
                        className="w-4 h-4 text-primary mt-0.5 shrink-0"
                        strokeWidth={2}
                      />
                      {limit}
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  variant={tier.popular ? "default" : "outline"}
                  style={
                    tier.popular
                      ? {
                          background:
                            "linear-gradient(135deg, var(--primary) 0%, var(--primary-end) 100%)",
                        }
                      : undefined
                  }
                >
                  {tier.cta}
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-14 sm:mt-18 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-4">
              All plans include
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {SHARED_FEATURES.map((feature) => (
                <span
                  key={feature}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm bg-card border border-border text-foreground/75"
                >
                  <Check className="w-3.5 h-3.5 text-primary" strokeWidth={2} />
                  {feature}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  )
}

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "",
    description: "Get started with the essentials",
    limits: [
      "50 pages / 2 weeks",
      "1 hr of narration / month",
      "20 AI messages / 2 weeks",
    ],
    cta: "Get Started",
    popular: false,
  },
  {
    name: "Plus",
    price: "$6",
    period: "/mo",
    description: "For regular readers",
    limits: ["300 pages", "5 hrs of narration", "200 AI messages"],
    cta: "Subscribe",
    popular: true,
  },
  {
    name: "Pro",
    price: "$22",
    period: "/mo",
    description: "For power users & researchers",
    limits: ["2,000 pages", "20 hrs of narration", "1,000 AI messages"],
    cta: "Subscribe",
    popular: false,
  },
]

const SHARED_FEATURES = [
  "All conversion modes",
  "File downloads",
  "Ambient sounds",
  "Color themes",
]

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="landing-theme min-h-screen flex flex-col antialiased bg-background text-foreground font-sans overflow-hidden">
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <a
          href="/"
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
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
          <span className="text-lg tracking-tight text-foreground font-serif font-bold">
            Academic Reader
          </span>
        </a>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="text-center text-sm py-8 px-6 border-t border-border text-muted-foreground">
        Academic Reader
      </footer>
    </div>
  )
}
