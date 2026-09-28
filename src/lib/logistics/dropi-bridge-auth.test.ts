import { generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  DROPI_BRIDGE_KEY_ID,
  dropiBridgeSigningInput,
  verifyDropiBridgeSignature,
} from './dropi-bridge-auth';

describe('Dropi bridge signature', () => {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const nowMs = Date.UTC(2026, 8, 28, 20, 0, 0);
  const timestamp = String(nowMs / 1000);
  const body = JSON.stringify({ shopify_order_id: '123', state: 'active' });
  const signature = sign(
    null,
    Buffer.from(dropiBridgeSigningInput(timestamp, body)),
    pair.privateKey,
  ).toString('base64');

  it('accepts the exact signed body inside the clock window', () => {
    expect(
      verifyDropiBridgeSignature({
        body,
        timestamp,
        signature,
        keyId: DROPI_BRIDGE_KEY_ID,
        nowMs,
        publicKey,
      }),
    ).toBe(true);
  });

  it('rejects tampering, stale requests and unknown keys', () => {
    expect(
      verifyDropiBridgeSignature({
        body: `${body} `,
        timestamp,
        signature,
        keyId: DROPI_BRIDGE_KEY_ID,
        nowMs,
        publicKey,
      }),
    ).toBe(false);
    expect(
      verifyDropiBridgeSignature({
        body,
        timestamp,
        signature,
        keyId: DROPI_BRIDGE_KEY_ID,
        nowMs: nowMs + 301_000,
        publicKey,
      }),
    ).toBe(false);
    expect(
      verifyDropiBridgeSignature({
        body,
        timestamp,
        signature,
        keyId: 'other',
        nowMs,
        publicKey,
      }),
    ).toBe(false);
  });
});
