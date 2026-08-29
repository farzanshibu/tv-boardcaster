/* Fixed-window rate limiter for auth and pairing endpoints.
   In-process by design; behind multiple nodes, front this with the edge/gateway limiter. */
const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref?.();

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress || 'unknown';

/**
 * @param {object} opts
 * @param {number} opts.max      requests allowed per window
 * @param {number} opts.windowMs window length
 * @param {string} opts.key      bucket namespace
 * @param {(req:any)=>string} [opts.identity] extra identity (e.g. email) to bucket on
 */
export function rateLimit({ max, windowMs, key, identity }) {
  return (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();
    const id = `${key}:${clientIp(req)}:${identity ? identity(req) || '' : ''}`;
    const now = Date.now();
    let b = buckets.get(id);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(id, b); }
    b.count++;
    const remaining = Math.max(0, max - b.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(b.reset / 1000));
    if (b.count > max) {
      const retry = Math.ceil((b.reset - now) / 1000);
      res.setHeader('Retry-After', retry);
      return res.status(429).json({ error: 'too_many_requests', retry_after_seconds: retry });
    }
    next();
  };
}

/** Clear a bucket after a successful attempt so honest users are not penalised. */
export function resetLimit(req, key, identityValue = '') {
  buckets.delete(`${key}:${clientIp(req)}:${identityValue}`);
}

export const authLimiter = rateLimit({
  key: 'auth', max: Number(process.env.RATE_LIMIT_AUTH || 10), windowMs: 15 * 60_000,
  identity: (req) => (req.body?.email || '').toLowerCase(),
});

export const pairingLimiter = rateLimit({
  key: 'pair', max: Number(process.env.RATE_LIMIT_PAIRING || 30), windowMs: 10 * 60_000,
});

export const signupLimiter = rateLimit({
  key: 'signup', max: Number(process.env.RATE_LIMIT_SIGNUP || 5), windowMs: 60 * 60_000,
});
