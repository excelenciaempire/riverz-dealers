import { describe, expect, it } from 'vitest';
import { safeNextPath } from './redirect';

describe('password login return path', () => {
  it('preserves the complete MCP OAuth request after login', () => {
    const next =
      '/oauth/autorizar?client_id=mcpc_test&redirect_uri=http%3A%2F%2Flocalhost%3A7777%2Fcallback&state=abc&code_challenge=challenge&code_challenge_method=S256&scope=mcp%3Aread';
    const search = new URLSearchParams({ next });
    expect(safeNextPath(search.get('next'))).toBe(next);
  });

  it('preserves English paths', () => {
    expect(safeNextPath('/settings?tab=mcp')).toBe('/settings?tab=mcp');
  });

  it.each([
    null,
    undefined,
    '',
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/\n/example.com',
    'javascript:alert(1)',
  ])('rejects unsafe or missing destinations: %s', (input) =>
    expect(safeNextPath(input)).toBe('/panel')
  );
});
