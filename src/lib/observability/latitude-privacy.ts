import { createHmac } from 'node:crypto';
import { redactModelSecrets } from '@/lib/security/model-secrets';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /^(?:authorization|cookie|password|.*(?:api.?key|secret|access.?token|refresh.?token)|email|phone|mobile|telefono|teléfono|full_name|first_name|last_name|customer_name|address\d*|direccion|dirección|shipping_address|billing_address|document_number|tax_id|base64|data)$/i;

export function latitudeId(kind: string, value: string): string {
  return `${kind.split(':')[0]}_${createHmac(
    'sha256',
    process.env.LATITUDE_API_KEY ?? 'latitude-disabled'
  )
    .update(`${kind}:${value}`)
    .digest('hex')
    .slice(0, 32)}`;
}

/** Best-effort text protection, plus exact known contact values. No model input is changed. */
export function scrubLatitudeText(
  text: string,
  privateValues: readonly string[] = []
): string {
  let clean = redactModelSecrets(text)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/\+?\d[\d ().-]{7,}\d/g, REDACTED)
    .replace(/https?:\/\/[^\s"<>]+/gi, '[REDACTED_URL]')
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|shp(?:at|ca|pa|ss)_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
      REDACTED
    );
  const credentials = Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /API_KEY|SECRET|TOKEN|PASSWORD|SERVICE_ROLE|ENCRYPTION_KEY/.test(key) &&
        value &&
        value.length >= 12
    )
    .map(([, value]) => value!);
  const names = privateValues
    .filter((value) => /^[\p{L} .'-]+$/u.test(value) && value.includes(' '))
    .map((value) => value.trim().split(/\s+/)[0]);
  for (const value of [...privateValues, ...names, ...credentials]) {
    if (value.trim().length < 3) continue;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
      REDACTED
    );
  }
  return clean.slice(0, 32_000);
}

export function scrubLatitudeValue(
  value: unknown,
  privateValues: readonly string[] = [],
  depth = 0
): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === 'string') {
    // Tool arguments/results and GenAI messages are often serialized JSON.
    if (/^\s*[\[{]/.test(value)) {
      try {
        return JSON.stringify(
          scrubLatitudeValue(JSON.parse(value), privateValues, depth + 1)
        );
      } catch {
        /* Plain text that happens to start with a bracket. */
      }
    }
    return scrubLatitudeText(value, privateValues);
  }
  if (Array.isArray(value))
    return value
      .slice(0, 100)
      .map((item) => scrubLatitudeValue(item, privateValues, depth + 1));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (['image', 'image_url', 'document', 'file'].includes(String(obj.type)))
      return { type: obj.type, content: '[REDACTED_MEDIA]' };
    return Object.fromEntries(
      Object.entries(obj).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key)
          ? REDACTED
          : scrubLatitudeValue(item, privateValues, depth + 1),
      ])
    );
  }
  return value;
}
