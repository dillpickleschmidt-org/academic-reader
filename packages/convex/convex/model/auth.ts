import type { QueryCtx, MutationCtx } from "../_generated/server"
import { authComponent } from "../auth"

// Returns user | null - for optional auth scenarios
export async function getUser(ctx: QueryCtx | MutationCtx) {
  try {
    return await authComponent.getAuthUser(ctx)
  } catch {
    return null
  }
}

// Throws if not authenticated
export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const user = await getUser(ctx)
  if (!user) throw new Error("Unauthenticated")
  return user
}
