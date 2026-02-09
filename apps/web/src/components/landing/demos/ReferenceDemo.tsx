export function ReferenceDemo() {
  return (
    <div className="space-y-3">
      {/* User message */}
      <div className="flex justify-end">
        <div className="bg-primary/8 rounded-2xl rounded-br-md px-4 py-2.5 max-w-[240px]">
          <p className="text-[11px] text-foreground/80 leading-relaxed">
            What does{" "}
            <span className="text-primary font-medium underline decoration-primary/30">
              Section 4.1(b)
            </span>{" "}
            discuss?
          </p>
        </div>
      </div>

      {/* "Following reference" indicator */}
      <div className="flex items-center gap-2 px-2">
        <div
          className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary/70"
          style={{ animation: "landing-spin 1s linear infinite" }}
        />
        <span className="text-[9px] text-primary/60 italic">
          Following reference...
        </span>
      </div>

      {/* AI response */}
      <div className="flex items-start gap-2">
        <div className="w-5 h-5 rounded-full bg-primary/12 flex items-center justify-center shrink-0 mt-1">
          <div className="w-2 h-2 rounded-full bg-primary/40" />
        </div>
        <div className="bg-background border border-border/50 rounded-2xl rounded-bl-md px-4 py-2.5 max-w-[260px] shadow-sm">
          <p className="text-[11px] text-foreground/65 leading-relaxed">
            Section 4.1(b) presents the{" "}
            <span className="text-foreground/80 font-medium">
              convergence criteria
            </span>{" "}
            for the iterative solver, proving stability when the step size
            satisfies...
          </p>
        </div>
      </div>
    </div>
  )
}
