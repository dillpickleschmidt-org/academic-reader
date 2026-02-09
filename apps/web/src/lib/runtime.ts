import { FetchHttpClient } from "@effect/platform"
import { ManagedRuntime } from "effect"

export const AppRuntime = ManagedRuntime.make(FetchHttpClient.layer)
