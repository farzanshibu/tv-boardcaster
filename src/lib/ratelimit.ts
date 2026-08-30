// SOT: rate-limiting, brute-force-protection
// WHAT:  fixed-window limiter for the endpoints an attacker would hammer.
// WHY:   a 4-digit pairing code and a login form are both guessable at volume.
//        Bucketing by IP *and* identity means one attacker cannot lock out the
//        account they are guessing at, which a pure identity bucket would allow.
// HOW:   in-process on purpose. Behind several nodes the edge or gateway limiter is
//        the real defence; this is the floor that always applies.
// WHERE: applied in src/routes/accounts.ts and src/routes/screens.ts

import type { Context } from 'hono';
import type { AppEnv, Middleware } from './http.js';

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

const sweeper = setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
}, 60_000);
sweeper.unref?.();

const clientIp = (c: Context<AppEnv>): string =>
  (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() ||
  c.req.header('x-real-ip') ||
  'unknown';

export type RateLimitOptions = {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
  /** Bucket namespace, so login and pairing do not share a counter. */
  key: string;
  /** Extra identity (an email, say) folded into the bucket. */
  identity?: (body: Record<string, unknown>) => string;
};

export function rateLimit({ max, windowMs, key, identity }: RateLimitOptions): Middleware {
  return async (c, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();

    // Hono caches a parsed body on the request, so reading it here does not consume
    // the stream the handler still needs.
    const extra = identity ? identity(await jsonBody(c)) || '' : '';

    const id = `${key}:${clientIp(c)}:${extra}`;
    const t = Date.now();
    let bucket = buckets.get(id);
    if (!bucket || bucket.reset < t) { bucket = { count: 0, reset: t + windowMs }; buckets.set(id, bucket); }
    bucket.count++;

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));

    if (bucket.count > max) {
      const retry = Math.ceil((bucket.reset - t) / 1000);
      c.header('Retry-After', String(retry));
      return c.json({ error: 'too_many_requests', retry_after_seconds: retry }, 429);
    }
    await next();
  };
}

/**
 * The request body as an object, or `{}` when it is missing or malformed.
 * Routes treat a bad body as absent fields and answer 400 on validation, which keeps
 * every endpoint's error shape the same.
 */
export async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await c.req.json();
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Clear a bucket after a success, so an honest user is not penalised for typos. */
export function resetLimit(c: Context<AppEnv>, key: string, identityValue = ''): void {
  buckets.delete(`${key}:${clientIp(c)}:${identityValue}`);
}

export const authLimiter = rateLimit({
  key: 'auth',
  max: Number(process.env.RATE_LIMIT_AUTH ?? 10),
  windowMs: 15 * 60_000,
  identity: (body) => String(body?.email ?? '').toLowerCase(),
});

export const pairingLimiter = rateLimit({
  key: 'pair',
  max: Number(process.env.RATE_LIMIT_PAIRING ?? 30),
  windowMs: 10 * 60_000,
});

export const signupLimiter = rateLimit({
  key: 'signup',
  max: Number(process.env.RATE_LIMIT_SIGNUP ?? 5),
  windowMs: 60 * 60_000,
});
