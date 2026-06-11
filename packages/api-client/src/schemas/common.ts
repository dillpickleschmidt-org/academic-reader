import { Schema } from "effect"

export const BackendType = Schema.Literals(["local", "datalab", "modal"])
export const ProcessingMode = Schema.Literals(["fast", "balanced", "aggressive"])

export type BackendType = typeof BackendType.Type
export type ProcessingMode = typeof ProcessingMode.Type
