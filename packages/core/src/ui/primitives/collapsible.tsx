import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  )
}

// Re-export primitives for advanced usage (render prop pattern)
const CollapsibleRoot = CollapsiblePrimitive.Root
const CollapsibleTriggerPrimitive = CollapsiblePrimitive.Trigger
const CollapsiblePanel = CollapsiblePrimitive.Panel

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTriggerPrimitive,
  CollapsiblePanel,
}
