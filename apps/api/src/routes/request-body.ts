import { HttpServerRequest } from "@effect/platform"
import { Effect, Schema } from "effect"
import { ValidationError } from "@academic-reader/api-client/errors"

export function decodeJsonBody<A, I>(schema: Schema.Schema<A, I, never>) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* request.json
    return yield* Schema.decodeUnknown(schema)(body).pipe(
      Effect.mapError(
        (error) =>
          new ValidationError({
            message: `Invalid request body: ${error.message}`,
          }),
      ),
    )
  })
}
