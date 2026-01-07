// Proxies /api/* (except auth) to Hono API
interface Env {
  API_HOST: string
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)

  // Let the auth function handle /api/auth/* routes
  if (url.pathname.startsWith("/api/auth")) {
    return context.next()
  }

  const path = url.pathname.replace("/api", "")
  const apiHost = context.env.API_HOST
  const targetUrl = `https://${apiHost}${path}${url.search}`

  return fetch(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  })
}
