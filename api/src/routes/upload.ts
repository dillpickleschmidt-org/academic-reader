import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../types';
import type { StorageAdapter, TempStorage } from '../storage';

// Extended context with storage adapters
type Variables = {
  storage: StorageAdapter | null;
  tempStorage: TempStorage | null;
};

const upload = new Hono<{ Bindings: Env; Variables: Variables }>();

// Upload file directly
upload.post('/upload', async (c) => {
  const backend = c.env.CONVERSION_BACKEND || 'local';

  // Local mode: passthrough to FastAPI worker
  if (backend === 'local') {
    const localUrl = c.env.LOCAL_WORKER_URL || 'http://localhost:8000';
    const formData = await c.req.formData();

    const response = await fetch(`${localUrl}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      return c.json({ error }, response.status as ContentfulStatusCode);
    }

    return c.json(await response.json());
  }

  // Datalab mode: store in temp storage for later direct upload
  if (backend === 'datalab') {
    const tempStorage = c.get('tempStorage');
    if (!tempStorage) {
      return c.json({ error: 'Temp storage not configured' }, { status: 500 });
    }

    try {
      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;

      if (!file || typeof file === 'string') {
        return c.json({ error: 'No file provided' }, { status: 400 });
      }

      const fileId = crypto.randomUUID();
      const arrayBuffer = await file.arrayBuffer();

      await tempStorage.store(fileId, {
        data: arrayBuffer,
        filename: file.name,
        contentType: file.type || 'application/pdf',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      });

      return c.json({
        file_id: fileId,
        filename: file.name,
        size: arrayBuffer.byteLength,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      return c.json({ error: message }, { status: 500 });
    }
  }

  // Runpod mode: upload to S3 storage
  if (backend === 'runpod') {
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'S3 storage not configured' }, { status: 500 });
    }

    try {
      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;

      if (!file || typeof file === 'string') {
        return c.json({ error: 'No file provided' }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const result = await storage.uploadFile(arrayBuffer, file.name, file.type || 'application/pdf');

      return c.json({
        file_id: result.fileId,
        filename: result.filename,
        size: result.size,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      return c.json({ error: message }, { status: 500 });
    }
  }

  return c.json({ error: `Unknown backend: ${backend}` }, { status: 400 });
});

// Get presigned upload URL (Runpod mode only)
upload.post('/upload-url', async (c) => {
  const backend = c.env.CONVERSION_BACKEND || 'local';

  if (backend !== 'runpod') {
    return c.json({ error: 'Presigned URLs only available for Runpod mode' }, { status: 400 });
  }

  const storage = c.get('storage');
  if (!storage) {
    return c.json({ error: 'S3 storage not configured' }, { status: 500 });
  }

  try {
    const body = await c.req.json<{ filename: string }>();
    const result = await storage.getPresignedUploadUrl(body.filename);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate upload URL';
    return c.json({ error: message }, { status: 500 });
  }
});

// Fetch file from URL
upload.post('/fetch-url', async (c) => {
  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const backend = c.env.CONVERSION_BACKEND || 'local';

  // Local mode: passthrough to FastAPI worker
  if (backend === 'local') {
    const localUrl = c.env.LOCAL_WORKER_URL || 'http://localhost:8000';
    const response = await fetch(`${localUrl}/fetch-url?url=${encodeURIComponent(url)}`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.text();
      return c.json({ error }, response.status as ContentfulStatusCode);
    }

    return c.json(await response.json());
  }

  // Fetch the file
  let fileResponse: Response;
  try {
    fileResponse = await fetch(url);
    if (!fileResponse.ok) {
      return c.json({ error: `Failed to fetch URL: ${fileResponse.statusText}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch URL';
    return c.json({ error: message }, { status: 500 });
  }

  const contentType = fileResponse.headers.get('content-type') || 'application/pdf';
  const filename = url.split('/').pop()?.split('?')[0] || 'document.pdf';
  const arrayBuffer = await fileResponse.arrayBuffer();

  // Datalab mode: store in temp storage
  if (backend === 'datalab') {
    const tempStorage = c.get('tempStorage');
    if (!tempStorage) {
      return c.json({ error: 'Temp storage not configured' }, { status: 500 });
    }

    const fileId = crypto.randomUUID();
    await tempStorage.store(fileId, {
      data: arrayBuffer,
      filename,
      contentType,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return c.json({
      file_id: fileId,
      filename,
      size: arrayBuffer.byteLength,
    });
  }

  // Runpod mode: store in S3
  if (backend === 'runpod') {
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'S3 storage not configured' }, { status: 500 });
    }

    const result = await storage.uploadFile(arrayBuffer, filename, contentType);
    return c.json({
      file_id: result.fileId,
      filename: result.filename,
      size: result.size,
    });
  }

  return c.json({ error: `Unknown backend: ${backend}` }, { status: 400 });
});

export { upload };
