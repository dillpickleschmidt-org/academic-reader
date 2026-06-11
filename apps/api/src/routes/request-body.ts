import { HttpServerRequest } from "effect/unstable/http"
import { Effect, Schema } from "effect"
import { ValidationError } from "@academic-reader/api-client/errors"

export function decodeJsonBody<A, I, RD, RE>(
  schema: Schema.Codec<A, I, RD, RE>,
) {
  return HttpServerRequest.schemaBodyJson(schema).pipe(
    Effect.mapError(
      (error) =>
        new ValidationError({
          message: `Invalid request body: ${error.message}`,
        }),
    ),
  )
}
