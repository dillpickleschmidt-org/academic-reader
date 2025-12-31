import type { ConversionBackend } from './interface';
import type { Env, BackendType } from '../types';
import { LocalBackend } from './local';
import { createRunpodBackend } from './runpod';
import { createDatalabBackend } from './datalab';

/**
 * Create the appropriate backend based on environment configuration.
 */
export function createBackend(env: Env): ConversionBackend {
  const backendType: BackendType = env.CONVERSION_BACKEND || 'local';

  switch (backendType) {
    case 'local':
      return new LocalBackend(env.LOCAL_WORKER_URL || 'http://localhost:8000');

    case 'runpod':
      return createRunpodBackend(env);

    case 'datalab':
      return createDatalabBackend(env);

    default:
      throw new Error(`Unknown backend type: ${backendType}`);
  }
}
