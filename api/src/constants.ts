// KV key prefixes
export const KV_KEYS = {
  JOB: 'job:',
  RESULT: 'result:',
  PROGRESS: 'progress:',
} as const;

// TTL values in seconds
export const TTL = {
  JOB: 86400, // 24 hours
  RESULT: 3600, // 1 hour
  PROGRESS: 300, // 5 minutes
} as const;

// Polling configuration
export const POLLING = {
  MAX_POLLS: 300, // 5 minutes at 1s intervals
  INTERVAL_MS: 1000,
} as const;
