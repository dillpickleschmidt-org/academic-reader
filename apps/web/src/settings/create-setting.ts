import { useState, useEffect } from "react"
import type { SettingDef } from "./registry"

export function createSetting<T extends string>(def: SettingDef<T>) {
  function read(): T {
    if (typeof window === "undefined") return def.defaultValue
    try {
      const saved = localStorage.getItem(def.key)
      if (saved && def.validate(saved)) return saved
    } catch {}
    return def.defaultValue
  }

  return function useSetting(): [T, (v: T) => void] {
    const [value, setValue] = useState<T>(read)

    useEffect(() => {
      if (typeof window === "undefined") return
      document.documentElement.setAttribute(def.attribute, value)
      def.onApply?.(value)
      try {
        localStorage.setItem(def.key, value)
      } catch {}
    }, [value])

    return [value, setValue]
  }
}
