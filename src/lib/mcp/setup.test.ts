import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import {
  CHATGPT_SETTINGS_URL,
  CHATGPT_INSTALL_URL,
  CLAUDE_INSTALL_URL,
  CLAUDE_CONNECTORS_URL,
  CLAUDE_DESKTOP_URL,
  desktopSetupUrl,
  editorInstallUrl,
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

  it('keeps ChatGPT on the plugin page with the Add action available', () => {
    const url = new URL(CHATGPT_INSTALL_URL);
    expect(url.origin).toBe('https://chatgpt.com');
    expect(url.pathname).toBe('/plugins');
    expect(url.hash).toBe('');
    expect(url.search).toBe('');
  });

  it('prefills the actual Claude connector form without credentials', () => {
    const url = new URL(CLAUDE_INSTALL_URL);
    expect(url.origin).toBe('https://claude.ai');
    expect(url.searchParams.get('modal')).toBe('add-custom-connector');
    expect(url.searchParams.get('connectorName')).toBe('Riverz');
    expect(url.searchParams.get('connectorUrl')).toBe(MCP_URL);
    expect([...url.searchParams.keys()]).toHaveLength(3);
  });

  it('hands Cursor its HTTP configuration rather than an mcpServers wrapper', () => {
    const url = new URL(editorInstallUrl('cursor'));
    expect(url.protocol).toBe('cursor:');
    expect(url.host).toBe('anysphere.cursor-deeplink');
    expect(url.pathname).toBe('/mcp/install');
    expect(url.searchParams.get('name')).toBe('riverz');
    expect(JSON.parse(atob(url.searchParams.get('config')!))).toEqual({
      url: MCP_URL,
    });
  });

  it('hands VS Code a complete encoded HTTP server configuration', () => {
    const url = new URL(editorInstallUrl('vscode'));
    expect(url.protocol).toBe('vscode:');
    expect(url.pathname).toBe('mcp/install');
    expect(JSON.parse(decodeURIComponent(url.search.slice(1)))).toEqual({
      name: 'riverz',
      type: 'http',
      url: MCP_URL,
    });
  });

  it('routes Claude account setup to connectors and desktop chat to the chat tab', () => {
    const connectors = new URL(CLAUDE_CONNECTORS_URL);
    expect(connectors.origin).toBe('https://claude.ai');
    expect(connectors.pathname).toBe('/customize/connectors');
    const desktop = new URL(CLAUDE_DESKTOP_URL);
    expect(desktop.protocol).toBe('claude:');
    expect(desktop.host).toBe('claude.ai');
    expect(desktop.pathname).toBe('/new');
    expect(new URL(desktopSetupUrl('claude', 'Setup')).host).toBe('code');
  });
});
