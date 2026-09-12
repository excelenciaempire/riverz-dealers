import { expect, it } from 'vitest';
import { redactModelContent, redactModelSecrets } from './model-secrets';

it.each([
  'GET https://graph.example/me?access_token=synthetic-provider-secret&fields=id HTTP 401',
  '{"refresh_token":"synthetic-provider-secret","status":"invalid_grant"}',
  'Authorization: Bearer synthetic-provider-secret',
  'api_key_encrypted="synthetic-provider-secret"',
])('removes embedded credentials without losing diagnostic context: %s', text => {
  expect(redactModelSecrets(text)).not.toContain('synthetic-provider-secret');
  expect(redactModelSecrets(text)).toContain('[REDACTED]');
});
it('preserves useful product, expiry, order and payment link data', () => {
  const text = 'Order RV-100, 49 USD; token_expires_at=2027-01-01; https://store.example/pay?id=RV-100';
  expect(redactModelSecrets(text)).toBe(text);
});
it('removes service role JWTs but preserves public anon tokens', () => {
  const token = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.syntheticSignature`;
  expect(redactModelSecrets(token('service_role'))).toBe('[REDACTED]');
  expect(redactModelSecrets(token('anon'))).toBe(token('anon'));
});
it('redacts tool-result text and preserves signed and binary blocks exactly', () => {
  const opaque = [{ type: 'thinking', thinking: 'signed content', signature: 'signature' },
    { type: 'image', source: { type: 'base64', data: 'opaque' } },
    { type: 'tool_use', id: 'tool-id', name: 'lookup_order', input: { order_number: 'RV-100' } }];
  const content = [...opaque, { type: 'tool_result', tool_use_id: 'tool-id', content: [{ type: 'text', text: 'access_token=synthetic-provider-secret' }] }];
  const result = redactModelContent(content) as typeof content;
  expect(result.slice(0, 3)).toEqual(opaque);
  expect(JSON.stringify(result)).not.toContain('synthetic-provider-secret');
  expect(JSON.stringify(content)).toContain('synthetic-provider-secret');
});
