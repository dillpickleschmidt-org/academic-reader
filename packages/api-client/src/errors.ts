import { Effect, Schema } from "effect"
import {
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/unstable/http"

export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  "StorageError",
  {
    message: Schema.String,
    key: Schema.optional(Schema.String),
  },
) {
  [HttpServerRespondable.symbol]() {
    return jsonError(this.message, 500)
  }
}

export class BackendError extends Schema.TaggedErrorClass<BackendError>()(
  "BackendError",
  { message: Schema.String, backend: Schema.String },
) {
  [HttpServerRespondable.symbol]() {
    return jsonError(this.message, 502)
  }
}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()(
  "AuthError",
  { message: Schema.String, code: Schema.String },
) {
  [HttpServerRespondable.symbol]() {
    return jsonError(this.message, 401)
  }
}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "ValidationError",
  {
    message: Schema.String,
    field: Schema.optional(Schema.String),
  },
) {
  [HttpServerRespondable.symbol]() {
    return jsonError(this.message, 400)
  }
}

function jsonError(message: string, status: number) {
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe({ error: message }, { status }),
  )
}
