import { Hono } from 'hono';
import type { Env, ConversionJob } from '../types';
import { KV_KEYS, TTL } from '../constants';

const webhooks = new Hono<{ Bindings: Env }>();

// Progress webhook (called by worker during conversion)
webhooks.post('/webhooks/progress', async (c) => {
  try {
    // Webhooks require KV (only available in Cloudflare Workers)
    if (!c.env.JOBS_KV) {
      return c.json({ error: 'Webhooks not available in self-hosted mode' }, { status: 501 });
    }

    const { job_id, stage, current, total } = await c.req.json<{
      job_id: string;
      stage: string;
      current: number;
      total: number;
    }>();

    await c.env.JOBS_KV.put(
      `${KV_KEYS.PROGRESS}${job_id}`,
      JSON.stringify({ stage, current, total, timestamp: Date.now() }),
      { expirationTtl: TTL.PROGRESS }
    );

    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Progress update failed';
    return c.json({ error: message }, { status: 500 });
  }
});

// Generic webhook handler for backend results
async function handleBackendWebhook(
  c: { env: Env; req: { raw: Request } },
  backendImport: () => Promise<{ handleWebhook: (req: Request) => Promise<ConversionJob> }>
) {
  // Webhooks require KV (only available in Cloudflare Workers)
  if (!c.env.JOBS_KV) {
    throw new Error('Webhooks not available in self-hosted mode');
  }

  try {
    const backend = await backendImport();
    const job = await backend.handleWebhook(c.req.raw);

    // Store result in KV for polling/SSE
    await c.env.JOBS_KV.put(`${KV_KEYS.RESULT}${job.jobId}`, JSON.stringify(job), {
      expirationTtl: TTL.RESULT,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    throw new Error(message);
  }
}

webhooks.post('/webhooks/runpod', async (c) => {
  try {
    const result = await handleBackendWebhook(c, async () => {
      const { createRunpodBackend } = await import('../backends/runpod');
      return createRunpodBackend(c.env);
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    return c.json({ error: message }, { status: 500 });
  }
});

webhooks.post('/webhooks/datalab', async (c) => {
  try {
    const result = await handleBackendWebhook(c, async () => {
      const { createDatalabBackend } = await import('../backends/datalab');
      return createDatalabBackend(c.env);
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    return c.json({ error: message }, { status: 500 });
  }
});

export { webhooks };
