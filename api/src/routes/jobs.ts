import { Hono } from 'hono';
import type { Env, ConversionJob } from '../types';
import { createBackend } from '../backends/factory';
import { LocalBackend } from '../backends/local';
import { KV_KEYS, POLLING } from '../constants';
import { enhanceHtmlForReader } from '../utils/html-processing';
import { transformSSEStream } from '../utils/sse-transform';

const jobs = new Hono<{ Bindings: Env }>();

jobs.get('/jobs/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  try {
    // Check KV cache first (for webhook results) - only if KV is available
    if (c.env.JOBS_KV) {
      const cached = await c.env.JOBS_KV.get(`${KV_KEYS.RESULT}${jobId}`);
      if (cached) {
        const job = JSON.parse(cached) as ConversionJob;
        // Apply HTML enhancements to content
        if (job.result?.content) {
          job.result.content = enhanceHtmlForReader(job.result.content);
        }
        return c.json({
          job_id: jobId,
          status: job.status,
          result: job.result,
          error: job.error,
        });
      }
    }

    // Fetch from backend directly
    const backend = createBackend(c.env);
    const job = await backend.getJobStatus(jobId);

    // Apply HTML enhancements to content
    if (job.result?.content) {
      job.result.content = enhanceHtmlForReader(job.result.content);
    }
    if (job.htmlContent) {
      job.htmlContent = enhanceHtmlForReader(job.htmlContent);
    }

    return c.json({
      job_id: jobId,
      status: job.status,
      result: job.result,
      html_content: job.htmlContent,
      error: job.error,
      progress: job.progress,
    });
  } catch (error) {
    return c.json({ error: 'Job not found' }, { status: 404 });
  }
});

// SSE stream endpoint
jobs.get('/jobs/:jobId/stream', async (c) => {
  const jobId = c.req.param('jobId');
  const backend = createBackend(c.env);

  // For local backend, proxy SSE stream with HTML enhancement
  if (backend.supportsStreaming() && backend instanceof LocalBackend) {
    const streamUrl = backend.getStreamUrl!(jobId);
    const response = await fetch(streamUrl);

    if (!response.ok || !response.body) {
      return c.json({ error: 'Failed to connect to stream' }, 500);
    }

    // Transform SSE events to enhance HTML content
    const transformedStream = transformSSEStream(response.body, (event, data) => {
      if (event === 'html_ready' || event === 'completed') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            parsed.content = enhanceHtmlForReader(parsed.content);
          }
          return JSON.stringify(parsed);
        } catch {
          return data;
        }
      }
      return data;
    });

    return new Response(transformedStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // For cloud backends, poll and emit SSE events
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let completed = false;
      let pollCount = 0;

      while (!completed && pollCount < POLLING.MAX_POLLS) {
        try {
          let job: ConversionJob;

          // Check KV cache first (for webhook results) - only if KV is available
          if (c.env.JOBS_KV) {
            const cached = await c.env.JOBS_KV.get(`${KV_KEYS.RESULT}${jobId}`);
            if (cached) {
              job = JSON.parse(cached) as ConversionJob;
            } else {
              job = await backend.getJobStatus(jobId);
            }

            // Read progress from KV (sent by worker via progress webhook)
            const progressData = await c.env.JOBS_KV.get(`${KV_KEYS.PROGRESS}${jobId}`);
            if (progressData) {
              const progress = JSON.parse(progressData);
              sendEvent('progress', progress);
            } else if (job.progress) {
              sendEvent('progress', job.progress);
            }
          } else {
            // No KV - just poll backend directly
            job = await backend.getJobStatus(jobId);
            if (job.progress) {
              sendEvent('progress', job.progress);
            }
          }

          switch (job.status) {
            case 'completed':
              // Apply HTML enhancements to content
              if (job.result?.content) {
                job.result.content = enhanceHtmlForReader(job.result.content);
              }
              sendEvent('completed', job.result);
              completed = true;
              break;
            case 'failed':
              sendEvent('failed', { error: job.error });
              completed = true;
              break;
            case 'html_ready':
              // Apply HTML enhancements to content
              const enhancedContent = job.htmlContent
                ? enhanceHtmlForReader(job.htmlContent)
                : job.htmlContent;
              sendEvent('html_ready', { content: enhancedContent });
              break;
          }

          if (!completed) {
            await new Promise((resolve) => setTimeout(resolve, POLLING.INTERVAL_MS));
            pollCount++;
          }
        } catch (error) {
          sendEvent('error', { message: 'Failed to get job status' });
          completed = true;
        }
      }

      if (!completed) {
        sendEvent('error', { message: 'Polling timeout' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

export { jobs };
