import { FetchHttpClient } from "effect/unstable/http"
import { ManagedRuntime } from "effect"

export const AppRuntime = ManagedRuntime.make(FetchHttpClient.layer)
