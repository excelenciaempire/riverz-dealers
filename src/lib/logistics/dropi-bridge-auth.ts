import { createHash, verify } from 'crypto';

export const DROPI_BRIDGE_KEY_ID = 'riverz-official-dropi-v1';
export const DROPI_BRIDGE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAE8okB+e78syxaDdi7jikDZstwEYETbJdQdAS73aCnyE=
-----END PUBLIC KEY-----`;

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export function dropiBridgeSigningInput(
  timestamp: string,
  body: string,
): string {
  const digest = createHash('sha256').update(body, 'utf8').digest('hex');
  return `${timestamp}\n${digest}`;
}

export function verifyDropiBridgeSignature(args: {
  body: string;
  timestamp: string | null;
  signature: string | null;
  keyId: string | null;
  nowMs?: number;
  publicKey?: string;
}): boolean {
  if (
    args.keyId !== DROPI_BRIDGE_KEY_ID ||
    !args.timestamp ||
    !args.signature
  ) {
    return false;
  }
  const timestamp = Number(args.timestamp);
  if (!Number.isInteger(timestamp)) return false;
  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;

  let signature: Buffer;
  try {
    signature = Buffer.from(args.signature, 'base64');
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;

  try {
    return verify(
      null,
      Buffer.from(dropiBridgeSigningInput(args.timestamp, args.body), 'utf8'),
      args.publicKey ?? DROPI_BRIDGE_PUBLIC_KEY,
      signature,
    );
  } catch {
    return false;
  }
}
