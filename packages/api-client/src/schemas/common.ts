import { Schema } from "effect"

export const BackendType = Schema.Literal("local", "datalab", "modal")
export const ProcessingMode = Schema.Literal("fast", "balanced", "aggressive")

export type BackendType = typeof BackendType.Type
export type ProcessingMode = typeof ProcessingMode.Type
