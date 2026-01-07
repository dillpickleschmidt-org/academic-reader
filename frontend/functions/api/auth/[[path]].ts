// Proxies /api/auth/* to Better Auth on Convex Site
export async function onRequest(
  context: EventContext<unknown, string, unknown>,
) {
  const url = new URL(context.request.url)
  const targetUrl = `https://convex-site.academic-reader.com${url.pathname}${url.search}`

  return fetch(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  })
}
