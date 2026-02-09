export function MathDemo() {
  return (
    <div className="flex items-center gap-2.5">
      {/* Equation */}
      <div className="px-3 py-2.5 bg-muted/40 rounded-xl border border-border/50 shrink-0">
        <span className="font-serif text-lg text-foreground/80 italic tracking-wide">
          {"∇ "}
          <span className="not-italic">{"·"}</span>
          {" E = ρ / ε"}
          <sub>0</sub>
        </span>
      </div>

      {/* Dashed connector */}
      <div className="h-px w-3 border-t-2 border-dashed border-primary/30 shrink-0" />

      {/* Explanation */}
      <div className="bg-primary/5 border border-primary/15 rounded-xl px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="w-4 h-4 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2.5"
            >
              <path d="M12 16v-4m0-4h.01" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="text-[9px] font-semibold text-primary/70 uppercase tracking-wider mb-0.5">
              In plain English
            </div>
            <p className="text-[11px] text-foreground/65 leading-relaxed">
              Electric charge creates a proportional electric field radiating
              outward from its source
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
