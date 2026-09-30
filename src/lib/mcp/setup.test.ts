import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import {
  CHATGPT_SETTINGS_URL,
  desktopSetupUrl,
  MCP_SETUP_COMMANDS,
  MCP_URL,
} from './setup';

describe('MCP desktop handoff', () => {
  it.each(['claude', 'codex'] as const)(
    '%s preserves the complete request in its official scheme',
    (client) => {
      const request =
        'Conecta Riverz: autorización & OAuth?\nhttps://riverz.co/api/mcp\nNo enviar automáticamente.';
      const url = new URL(desktopSetupUrl(client, request));
      expect(url.protocol).toBe(client === 'claude' ? 'claude:' : 'codex:');
      expect(url.host).toBe(client === 'claude' ? 'code' : 'new');
      expect(url.pathname).toBe(client === 'claude' ? '/new' : '');
      expect([...url.searchParams.keys()]).toEqual([
        client === 'claude' ? 'q' : 'prompt',
      ]);
      expect(url.searchParams.get(client === 'claude' ? 'q' : 'prompt')).toBe(
        request
      );
    }
  );

  it.each([
    ['claude', 'es'],
    ['claude', 'en'],
    ['codex', 'es'],
    ['codex', 'en'],
  ] as const)('hands %s a complete setup request in %s', (client, locale) => {
    const request = translate(locale, 'oauth.desktopSetupRequest', {
      client: client === 'claude' ? 'Claude Code' : 'Codex',
      url: MCP_URL,
      commands: MCP_SETUP_COMMANDS[client],
    });
    const url = new URL(desktopSetupUrl(client, request));
    expect(request).toContain(MCP_URL);
    expect(request).toContain(MCP_SETUP_COMMANDS[client]);
    expect(request).not.toMatch(
      /\{(?:client|url|commands)\}|oauth\.desktopSetupRequest/
    );
    expect(url.searchParams.get(client === 'claude' ? 'q' : 'prompt')).toBe(
      request
    );
  });

  it('opens ChatGPT connection settings instead of the plugin directory', () => {
    const url = new URL(CHATGPT_SETTINGS_URL);
    expect(url.origin).toBe('https://chatgpt.com');
    expect(url.pathname).toBe('/');
    expect(url.hash).toBe('#settings/Connectors');
  });
});
