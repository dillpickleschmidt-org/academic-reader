// Proxies /api/* (except auth) to Hono API
export async function onRequest(
  context: EventContext<unknown, string, unknown>,
) {
  const url = new URL(context.request.url)
  const path = url.pathname.replace("/api", "")
  const targetUrl = `https://api.academic-reader.com${path}${url.search}`

  return fetch(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  })
}
