import { createHmac, randomBytes } from 'node:crypto';

// Lets a journal parser tell whether two tool calls were identical without keeping what either
// one said. Every call of this function draws a fresh random key that stays inside the closure:
// it is never returned, stored, logged or written to disk. The function it returns gives
// HMAC-SHA-256 of the text under that key, cut to 72 bits. Without the key a fingerprint cannot
// be checked against a guessed path or query, and fingerprints made by two parsers, or by two
// runs, cannot be matched with one another.
export function createCallFingerprint() {
  const key = randomBytes(32);
  return text => createHmac('sha256', key).update(text).digest('base64url').slice(0, 12);
}
