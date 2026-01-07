# Cloudflare Pages Functions

Proxy functions to keep all requests on same origin for cookie-based auth.

## Routes

- `/api/auth/*` → Convex Site (Better Auth)
- `/api/*` → Hono API

## How It Works

These functions run on Cloudflare's edge and proxy requests to backend services
via internal tunnel subdomains. This allows the browser to see a single origin
(`academic-reader.com`), enabling cookies to work seamlessly across auth and API.
