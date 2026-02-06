export function ScanDemo() {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-5 items-center">
      {/* Scanned page (photo-like) */}
      <div className="relative w-32 bg-amber-50/50 dark:bg-amber-950/10 rounded-lg p-3 -rotate-1 shadow border border-border/30 overflow-hidden">
        <div className="space-y-2 opacity-50">
          <div className="h-2 bg-foreground/25 rounded w-3/4" />
          <div className="space-y-1.5">
            <div className="h-1.5 bg-foreground/18 rounded w-full" />
            <div className="h-1.5 bg-foreground/15 rounded w-11/12" />
            <div className="h-1.5 bg-foreground/18 rounded w-full" />
            <div className="h-1.5 bg-foreground/12 rounded w-7/12" />
          </div>
          <div className="space-y-1.5">
            <div className="h-1.5 bg-foreground/18 rounded w-full" />
            <div className="h-1.5 bg-foreground/15 rounded w-10/12" />
            <div className="h-1.5 bg-foreground/18 rounded w-full" />
          </div>
        </div>
        {/* Scan noise overlay */}
        <div
          className="absolute inset-0 pointer-events-none rounded-lg"
          style={{ background: "radial-gradient(circle, var(--foreground) 0.4px, transparent 0.4px)", backgroundSize: "5px 5px", opacity: 0.03 }}
        />
      </div>

      {/* Digital output */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-2 bg-foreground/12 rounded flex-1" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-1.5 bg-foreground/10 rounded w-1/3" />
          <span className="text-[8px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/15">Section 2.1</span>
          <div className="h-1.5 bg-foreground/10 rounded flex-1" />
        </div>
        <div className="h-1.5 bg-foreground/10 rounded w-full" />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-1.5 bg-foreground/10 rounded w-2/5" />
          <span className="text-[8px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/15">Figure 4</span>
        </div>
        <div className="h-1.5 bg-foreground/10 rounded w-11/12" />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-1.5 bg-foreground/10 rounded flex-1" />
          <span className="text-[8px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/15">Table 1</span>
        </div>
      </div>
    </div>
  )
}
