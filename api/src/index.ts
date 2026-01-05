/**
 * Cloudflare Workers API entry point.
 * Uses KV for job state, S3 API for storage (R2).
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { upload, convert, jobs, download, webhooks } from './routes';
import { createStorage, KVTempStorage, type S3Storage, type TempStorage } from './storage';

// Extended context with storage adapters
type Variables = {
  storage: S3Storage | null;
  tempStorage: TempStorage | null;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware to inject storage adapters
app.use('*', async (c, next) => {
  // Create storage based on backend type
  const storage = createStorage(c.env);
  c.set('storage', storage);

  // Create temp storage using KV (for Datalab mode)
  if (c.env.JOBS_KV) {
    c.set('tempStorage', new KVTempStorage(c.env.JOBS_KV));
  } else {
    c.set('tempStorage', null);
  }

  await next();
});

// CORS middleware
app.use('*', async (c, next) => {
  const origins = c.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || ['http://localhost:5173'];
  return cors({
    origin: (origin) => {
      // Allow exact matches
      if (origins.includes(origin)) return origin;
      // Allow Cloudflare Pages preview URLs (e.g., abc123.academic-reader-2w0.pages.dev)
      for (const allowed of origins) {
        const match = allowed.match(/^https:\/\/([^.]+\.pages\.dev)$/);
        if (match) {
          const projectDomain = match[1]; // e.g., "academic-reader-2w0.pages.dev"
          if (origin.endsWith(`.${projectDomain}`) || origin === `https://${projectDomain}`) {
            return origin;
          }
        }
      }
      return null;
    },
  })(c, next);
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', backend: c.env.BACKEND_MODE, mode: 'cloudflare' }));

// Mount route modules
app.route('/', upload);
app.route('/', convert);
app.route('/', jobs);
app.route('/', download);
app.route('/', webhooks);

export default app;
