export function PhoneFriendlyDemo() {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
      {/* Before: 2-column PDF crammed on a phone */}
      <div className="flex flex-col items-center gap-2">
        <div className="text-[7px] uppercase tracking-widest text-muted-foreground/50 font-mono">PDF on mobile</div>
        <div className="w-full max-w-[110px] aspect-[9/16] rounded-2xl border-2 border-muted-foreground/20 p-2 pb-3 bg-muted/30 flex flex-col">
          <div className="rounded-lg bg-background p-2 space-y-1.5 flex-1 overflow-hidden">
            {/* Title */}
            <div className="h-1.5 bg-muted-foreground/18 rounded w-4/5 mx-auto" />
            {/* Two-column layout - tiny unreadable */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-[2px]">
                {[...Array(8)].map((_, j) => (
                  <div key={j} className="h-[1.5px] bg-muted-foreground/12 rounded" style={{ width: `${65 + (j * 13) % 35}%` }} />
                ))}
              </div>
              <div className="space-y-[2px]">
                {[...Array(8)].map((_, j) => (
                  <div key={j} className="h-[1.5px] bg-muted-foreground/12 rounded" style={{ width: `${60 + (j * 17) % 35}%` }} />
                ))}
              </div>
            </div>
            {/* Figure placeholder */}
            <div className="h-5 bg-muted-foreground/5 rounded border border-dashed border-muted-foreground/8" />
            {/* More 2-col text */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-[2px]">
                {[...Array(6)].map((_, j) => (
                  <div key={j} className="h-[1.5px] bg-muted-foreground/12 rounded" style={{ width: `${70 + (j * 11) % 30}%` }} />
                ))}
              </div>
              <div className="space-y-[2px]">
                {[...Array(6)].map((_, j) => (
                  <div key={j} className="h-[1.5px] bg-muted-foreground/12 rounded" style={{ width: `${55 + (j * 19) % 40}%` }} />
                ))}
              </div>
            </div>
          </div>
          <div className="w-8 h-0.5 bg-muted-foreground/12 rounded-full mx-auto mt-2" />
        </div>
      </div>

      {/* Arrow */}
      <svg className="shrink-0 text-primary/50" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14m-4-4 4 4-4 4" />
      </svg>

      {/* After: clean single-column on phone */}
      <div className="flex flex-col items-center gap-2">
        <div className="text-[7px] uppercase tracking-widest text-primary/50 font-mono">Converted</div>
        <div className="w-full max-w-[110px] aspect-[9/16] rounded-2xl border-2 border-primary/25 p-2 pb-3 bg-background shadow-sm flex flex-col">
          <div className="rounded-lg bg-background p-2 space-y-2 flex-1 overflow-hidden">
            {/* Title */}
            <div className="h-2 bg-primary/20 rounded w-4/5" />
            {/* Single-column readable text */}
            <div className="space-y-1">
              {[...Array(5)].map((_, j) => (
                <div key={j} className="h-[2.5px] bg-foreground/10 rounded" style={{ width: `${80 + (j * 11) % 20}%` }} />
              ))}
            </div>
            <div className="h-[2.5px] bg-foreground/10 rounded w-3/5" />
            {/* Subheading */}
            <div className="h-1.5 bg-primary/15 rounded w-3/5 mt-1" />
            {/* More text */}
            <div className="space-y-1">
              {[...Array(5)].map((_, j) => (
                <div key={j} className="h-[2.5px] bg-foreground/10 rounded" style={{ width: `${75 + (j * 13) % 25}%` }} />
              ))}
            </div>
            <div className="h-[2.5px] bg-foreground/10 rounded w-2/5" />
          </div>
          <div className="w-8 h-0.5 bg-primary/15 rounded-full mx-auto mt-2" />
        </div>
      </div>
    </div>
  )
}
