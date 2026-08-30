// SOT: totp, two-factor, rfc6238
// WHAT:  time-based one-time passwords, implemented against RFC 6238.
// WHY:   2FA is a plan feature and an org-level requirement, so it ships in the
//        service rather than depending on an external verifier.
// HOW:   HMAC-SHA1 over the 30-second counter, truncated the way the RFC specifies.
//        No database and no I/O, so this module is safe to import anywhere.
// WHERE: enrolment and login checks in src/lib/auth.ts

import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';


export const totpSecret = (): string =>
  Array.from(crypto.randomBytes(20)).map((b) => B32[b % 32]).join('');

function b32decode(s: string): Buffer {
  let bits = '';
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, '0');
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export function totpCode(secret: string, t: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(t / 30000)));
  const hmac = crypto.createHmac('sha1', b32decode(secret)).update(counter).digest();
  const off = hmac[hmac.length - 1]! & 0xf;
  const bin = ((hmac[off]! & 0x7f) << 24) | (hmac[off + 1]! << 16) | (hmac[off + 2]! << 8) | hmac[off + 3]!;
  return String(bin % 1e6).padStart(6, '0');
}

/** One step either side, so a slow entry or a skewed phone clock still works. */
export const totpVerify = (secret: string, code: unknown): boolean =>
  [-1, 0, 1].some((d) => totpCode(secret, Date.now() + d * 30000) === String(code ?? '').trim());
