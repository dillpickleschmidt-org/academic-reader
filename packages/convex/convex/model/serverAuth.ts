export function requireApiToConvexServiceSecret(secret: string) {
  const expected = process.env.API_TO_CONVEX_SERVICE_SECRET
  if (!expected || secret !== expected) throw new Error("Unauthorized")
}
