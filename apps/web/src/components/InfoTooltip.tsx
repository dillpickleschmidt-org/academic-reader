import { useState, useEffect, useRef } from "react"
import { HelpCircle, Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@academic-reader/ui/primitives/tooltip"
import { cn } from "@academic-reader/ui/utils"

interface InfoTooltipProps {
  content: string
  variant?: "question" | "info"
  side?: "top" | "bottom" | "left" | "right"
  className?: string
  iconClassName?: string
}

export function InfoTooltip({
  content,
  variant = "question",
  side = "top",
  className,
  iconClassName,
}: InfoTooltipProps) {
  const Icon = variant === "info" ? Info : HelpCircle
  const [isPinned, setIsPinned] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const isOpen = isPinned || isHovering

  useEffect(() => {
    if (!isPinned) return

    const handleClickOutside = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      setIsPinned(false)
    }

    document.addEventListener("click", handleClickOutside)
    return () => document.removeEventListener("click", handleClickOutside)
  }, [isPinned])

  return (
    <Tooltip open={isOpen}>
      <TooltipTrigger
        ref={triggerRef}
        className={cn(
          "inline-flex cursor-help text-muted-foreground/60 hover:text-muted-foreground transition-colors",
          isPinned && "text-muted-foreground",
          className,
        )}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsPinned(!isPinned)
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <Icon className={cn("w-3.5 h-3.5", iconClassName)} />
      </TooltipTrigger>
      <TooltipContent
        side={side}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  )
}
