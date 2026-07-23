/**
 * Rate limiting — Module 1 (AUTH-01/AUTH-02 "Security Considerations":
 * brute-force protection).
 *
 * V1: in-memory sliding-window limiter, keyed by IP + route. This is enough
 * for a single-instance MVP; if Nibras is ever deployed across multiple
 * backend instances, this should move to a shared store (Redis/Turso table)
 * so limits are consistent across instances.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Periodically drop expired buckets so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60_000).unref?.();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * @param key       unique identifier for the caller+route, e.g. `login:1.2.3.4`.
 * @param max       max allowed attempts within the window.
 * @param windowMs  window duration in milliseconds.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: max - existing.count, retryAfterSeconds: 0 };
}

/** Extracts a best-effort client IP from Elysia request headers. */
export function clientIpFromHeaders(headers: Record<string, string | undefined>): string {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers['x-real-ip'] ?? 'unknown';
}
