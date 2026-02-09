export function AmbienceDemo() {
  const sounds = [
    { label: "Rain", active: true, bars: [4, 7, 5, 8, 6] },
    { label: "Fireplace", active: true, bars: [6, 3, 7, 4, 8] },
    { label: "Brown noise", active: false, bars: [5, 5, 5, 5, 5] },
    { label: "Lo-fi", active: false, bars: [3, 6, 4, 7, 5] },
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {sounds.map((s) => (
          <div
            key={s.label}
            className={`
              flex flex-col items-center gap-2 py-3 px-2 rounded-xl border transition-colors
              ${s.active ? "bg-primary/6 border-primary/20" : "bg-muted/30 border-border/40"}
            `}
          >
            <div className="flex items-end gap-[2px] h-5">
              {s.bars.map((h, j) => (
                <div
                  key={j}
                  className={`w-[3px] rounded-full ${s.active ? "bg-primary/40" : "bg-muted-foreground/15"}`}
                  style={{
                    height: `${s.active ? h * 12 : 30}%`,
                    animation: s.active
                      ? `waveform-pulse ${0.5 + j * 0.12}s ease-in-out infinite ${j * 0.08}s`
                      : undefined,
                  }}
                />
              ))}
            </div>
            <span
              className={`text-[8px] whitespace-nowrap ${s.active ? "text-primary font-medium" : "text-muted-foreground"}`}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
        <span>Mix volume</span>
        <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
          <div className="h-full w-3/5 bg-primary/30 rounded-full" />
        </div>
      </div>
    </div>
  )
}
