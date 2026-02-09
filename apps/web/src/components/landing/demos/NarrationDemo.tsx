export function NarrationDemo() {
  const bars = [
    2, 4, 7, 5, 3, 6, 8, 9, 7, 5, 4, 6, 3, 2, 1, 2, 3, 5, 7, 8, 6, 4, 5, 7, 9,
    8, 6, 4, 3, 5,
  ]
  return (
    <div className="space-y-3">
      {/* Player chrome */}
      <div className="flex items-center gap-3">
        <button className="w-10 h-10 rounded-full bg-primary/12 flex items-center justify-center shrink-0 hover:bg-primary/18 transition-colors">
          <svg width="12" height="14" viewBox="0 0 10 12" fill="var(--primary)">
            <polygon points="1,0 1,12 9.5,6" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-end gap-[2px] h-10">
            {bars.map((h, i) => {
              const isSkipped = i >= 10 && i <= 16
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full min-w-[2px] ${isSkipped ? "bg-muted-foreground/10" : "bg-primary/30"}`}
                  style={{ height: `${h * 10}%` }}
                />
              )
            })}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
          0:42 / 3:15
        </span>
      </div>

      {/* Skip indicator */}
      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30" />
          <span>Reading</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/10" />
          <span>Citations skipped</span>
        </div>
      </div>
    </div>
  )
}
