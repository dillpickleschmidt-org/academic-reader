import { Schema } from "effect"

export class ApiError extends Schema.TaggedError<ApiError>("ApiError")(
  "ApiError",
  { message: Schema.String, status: Schema.Number },
) {}

export class StorageError extends Schema.TaggedError<StorageError>("StorageError")(
  "StorageError",
  { message: Schema.String, key: Schema.optional(Schema.String) },
) {}

export class BackendError extends Schema.TaggedError<BackendError>("BackendError")(
  "BackendError",
  { message: Schema.String, backend: Schema.String },
) {}

export class AuthError extends Schema.TaggedError<AuthError>("AuthError")(
  "AuthError",
  { message: Schema.String, code: Schema.String },
) {}

export class ValidationError extends Schema.TaggedError<ValidationError>("ValidationError")(
  "ValidationError",
  { message: Schema.String, field: Schema.optional(Schema.String) },
) {}
