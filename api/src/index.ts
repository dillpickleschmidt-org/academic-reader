/**
 * Cloudflare Workers API entry point.
 * Uses KV for job state, S3 API for storage (R2).
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { upload, convert, jobs, webhooks } from './routes';
import { createStorage, KVTempStorage, type StorageAdapter, type TempStorage } from './storage';

// Extended context with storage adapters
type Variables = {
  storage: StorageAdapter | null;
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
  return cors({ origin: origins })(c, next);
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', backend: c.env.CONVERSION_BACKEND, mode: 'cloudflare' }));

// Mount route modules
app.route('/', upload);
app.route('/', convert);
app.route('/', jobs);
app.route('/', webhooks);

export default app;
