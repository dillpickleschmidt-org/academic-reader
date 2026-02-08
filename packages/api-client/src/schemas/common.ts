import { Schema } from "effect"

export const BackendType = Schema.Literal("local", "datalab", "modal")
export const ProcessingMode = Schema.Literal("fast", "balanced", "aggressive")
export const JobStatus = Schema.Literal(
  "pending",
  "processing",
  "html_ready",
  "completed",
  "failed",
)

export type BackendType = typeof BackendType.Type
export type ProcessingMode = typeof ProcessingMode.Type
export type JobStatus = typeof JobStatus.Type
