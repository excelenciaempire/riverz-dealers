import { describe, expect, it } from 'vitest';
import { connectedClients, type OAuthConnectionToken } from './connections';

const now = Date.parse('2026-09-30T12:00:00Z');
const token: OAuthConnectionToken = {
  name: 'Claude Code',
  origin: 'oauth',
  client_id: 'mcpc_test',
  expires_at: '2026-09-30T13:00:00Z',
  last_used_at: '2026-09-30T11:59:00Z',
  verified_at: '2026-09-30T11:59:00Z',
};

describe('verified MCP connections', () => {
  it('recognizes clients only after an authenticated MCP request', () => {
    expect([
      ...connectedClients(
        [token, { ...token, name: 'Codex' }, { ...token, name: 'ChatGPT' }],
        now
      ),
    ]).toEqual(['claude', 'codex', 'chatgpt']);
  });

  it.each([
    { origin: 'manual' },
    { client_id: null },
    { last_used_at: null },
    { verified_at: null },
    { expires_at: null },
    { expires_at: '2026-09-30T11:00:00Z' },
    { expires_at: 'invalid' },
  ])('never reports an unverified or expired connection: %j', (override) => {
    expect(connectedClients([{ ...token, ...override }], now).size).toBe(0);
  });

  it('does not classify unrelated clients as Claude or Codex', () => {
    expect(
      connectedClients([{ ...token, name: 'Other client' }], now).size
    ).toBe(0);
  });

  it('keeps Claude account and local Claude Code connections distinct', () => {
    expect([...connectedClients([{ ...token, name: 'Claude' }], now)]).toEqual([
      'claude-chat',
    ]);
    expect([...connectedClients([token], now)]).toEqual(['claude']);
  });
});
