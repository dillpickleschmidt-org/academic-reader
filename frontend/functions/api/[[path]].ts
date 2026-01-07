// Proxies /api/* to appropriate backend
interface Env {
  API_HOST: string
  CONVEX_SITE_HOST: string
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const requestHost = url.hostname

  // Route /api/auth/* to Convex (Better Auth)
  if (url.pathname.startsWith("/api/auth")) {
    const convexSiteHost = context.env.CONVEX_SITE_HOST
    const targetUrl = `https://${convexSiteHost}${url.pathname}${url.search}`

    const response = await fetch(targetUrl, {
      method: context.request.method,
      headers: context.request.headers,
      body: context.request.body,
    })

    // Rewrite Set-Cookie domain to match the request origin
    const newHeaders = new Headers()
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() === "set-cookie") {
        const rewritten = value.replace(
          /;\s*domain=[^;]*/gi,
          `; Domain=${requestHost}`,
        )
        newHeaders.append(key, rewritten)
      } else {
        newHeaders.append(key, value)
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  }

  // Route everything else to Hono API
  const path = url.pathname.replace("/api", "")
  const apiHost = context.env.API_HOST
  const targetUrl = `https://${apiHost}${path}${url.search}`

  return fetch(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  })
}
