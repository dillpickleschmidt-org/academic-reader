export function ConversionDemo() {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
      {/* Before */}
      <div className="bg-muted/40 rounded-xl p-4 border border-border/50">
        <div className="text-[7px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-3">Original PDF</div>
        <div className="space-y-2">
          <div className="h-2.5 bg-muted-foreground/20 rounded w-2/3" />
          <div className="space-y-1">
            <div className="h-1.5 bg-muted-foreground/12 rounded w-full" />
            <div className="h-1.5 bg-muted-foreground/10 rounded w-11/12" style={{ transform: "translateX(2px)" }} />
            <div className="h-1.5 bg-muted-foreground/12 rounded w-10/12" />
          </div>
          {/* Broken table */}
          <div className="grid grid-cols-3 gap-0.5 mt-1">
            <div className="h-4 bg-muted-foreground/8 rounded-sm" />
            <div className="h-4 bg-muted-foreground/8 rounded-sm translate-y-px" />
            <div className="h-4 bg-muted-foreground/6 rounded-sm" />
            <div className="h-4 bg-muted-foreground/6 rounded-sm translate-x-0.5" />
            <div className="h-4 bg-muted-foreground/6 rounded-sm" />
            <div className="h-4 bg-muted-foreground/5 rounded-sm -translate-y-px" />
          </div>
          {/* Garbled figure placeholder */}
          <div className="h-10 bg-muted-foreground/6 rounded border border-dashed border-muted-foreground/10 flex items-center justify-center">
            <span className="text-[8px] text-muted-foreground/30 font-mono">fig_2.png</span>
          </div>
        </div>
      </div>

      {/* Arrow */}
      <div className="flex flex-col items-center gap-1">
        <svg className="text-primary/50" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14m-4-4 4 4-4 4" />
        </svg>
      </div>

      {/* After */}
      <div className="bg-background rounded-xl p-4 border border-primary/15 shadow-sm">
        <div className="text-[7px] uppercase tracking-widest text-primary/50 font-mono mb-3">Converted</div>
        <div className="space-y-2">
          <div className="h-2.5 bg-primary/20 rounded w-2/3" />
          <div className="space-y-1">
            <div className="h-1.5 bg-foreground/10 rounded w-full" />
            <div className="h-1.5 bg-foreground/10 rounded w-11/12" />
            <div className="h-1.5 bg-foreground/10 rounded w-10/12" />
          </div>
          {/* Clean table */}
          <div className="border border-border/40 rounded overflow-hidden">
            <div className="grid grid-cols-3 gap-px bg-border/30">
              <div className="h-4 bg-primary/8" />
              <div className="h-4 bg-primary/8" />
              <div className="h-4 bg-primary/8" />
              <div className="h-4 bg-background" />
              <div className="h-4 bg-background" />
              <div className="h-4 bg-background" />
            </div>
          </div>
          {/* Clean figure */}
          <div className="h-10 bg-primary/5 rounded border border-primary/10 flex items-center justify-center">
            <svg className="text-primary/30" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
