import { describe, expect, it, vi } from 'vitest';
import {
  latitudeId,
  scrubLatitudeText,
  scrubLatitudeValue,
} from './latitude-privacy';

describe('Latitude export privacy', () => {
  it('redacts known names, credentials, phone numbers, email and signed URLs without changing model data', () => {
    const original =
      'Ana Pérez: ana@example.com +573001234567 https://store.test?token=secret Bearer abcdefghijklmnop';
    const clean = scrubLatitudeText(original, ['Ana Pérez']);
    for (const privateValue of [
      'Ana Pérez',
      'ana@example.com',
      '573001234567',
      'store.test',
      'abcdefghijklmnop',
    ])
      expect(clean).not.toContain(privateValue);
    expect(original).toContain('Ana Pérez');
    expect(scrubLatitudeText('Hola Ana, hablamos mañana.', ['Ana Pérez'])).toBe(
      'Hola [REDACTED], hablamos mañana.'
    );
  });
  it('scrubs serialized tool payloads, including numeric identifiers and binary media', () => {
    const input = JSON.stringify({
      address1: 'Calle Privada 123',
      phone: 573001234567,
      total: 29,
      result: [{ type: 'image', source: { data: 'binary-private' } }],
    });
    const output = JSON.parse(scrubLatitudeValue(input) as string);
    expect(output).toMatchObject({
      address1: '[REDACTED]',
      phone: '[REDACTED]',
      total: 29,
    });
    expect(JSON.stringify(output)).not.toContain('binary-private');
  });
  it('keeps pseudonyms stable while isolating users across workspaces without leaking IDs in prefixes', () => {
    expect(latitudeId('user:workspace-a', 'person-1')).toBe(
      latitudeId('user:workspace-a', 'person-1')
    );
    expect(latitudeId('user:workspace-a', 'person-1')).not.toBe(
      latitudeId('user:workspace-b', 'person-1')
    );
    expect(latitudeId('session:workspace-a', 'conversation')).not.toContain(
      'workspace-a'
    );
  });
  it('also removes unprefixed secrets from the process configuration', () => {
    vi.stubEnv('LATITUDE_API_KEY', 'secret-with-no-vendor-prefix');
    try {
      expect(
        scrubLatitudeText('failure: secret-with-no-vendor-prefix')
      ).not.toContain('secret-with-no-vendor-prefix');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
