import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/lib/i18n/translate';
import { CHATGPT_INSTALL_URL, CLAUDE_INSTALL_URL, MCP_URL } from '@/lib/mcp/setup';

const h = vi.hoisted(() => ({
  locale: 'es' as 'es' | 'en', index: 0, bank: [] as unknown[],
  csrf: vi.fn(), copy: vi.fn(), open: vi.fn(), toast: vi.fn(), events: [] as string[],
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.bank)) h.bank[index] = initial;
    return [h.bank[index], (value: unknown) => {
      h.bank[index] = typeof value === 'function' ? value(h.bank[index]) : value;
    }];
  },
  useEffect: () => {},
}));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string, params?: Record<string, string | number>) => translate(h.locale, key, params) }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => h.csrf }));
vi.mock('sonner', () => ({ toast: { error: h.toast } }));
vi.mock('next/image', () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
  const { unoptimized: _ignored, ...rest } = props;
  void _ignored;
  return React.createElement('img', rest);
} }));
vi.mock('@/components/ui/button', () => ({ Button: ({ variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => {
  void _variant; void _size;
  return React.createElement('button', props);
} }));
import { McpOauthConnect } from './mcp-oauth-connect';

type Element = React.ReactElement<Record<string, unknown>>;
function nodes(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...nodes(element.props.children as React.ReactNode)];
}
function render() { h.index = 0; return McpOauthConnect(); }
function button(key: string) {
  const label = translate(h.locale, key, { client: key === 'oauth.connectWith' ? 'ChatGPT' : '' });
  const match = nodes(render()).find(node => Array.isArray(node.props.children) && node.props.children.includes(label));
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}
async function prepareChatgpt() {
  (button('oauth.connectWith').props.onClick as () => void)();
  await vi.waitFor(() => expect(h.bank[3]).toBe(false));
}
beforeEach(() => {
  vi.clearAllMocks(); h.index = 0; h.bank = []; h.events = []; h.locale = 'es';
  h.csrf.mockResolvedValue(new Response(JSON.stringify({ id: 'temporary-check', expires_at: '2026-10-02T02:15:00Z' })));
  h.copy.mockImplementation(async () => { h.events.push('copy'); });
  h.open.mockImplementation(() => { h.events.push('open'); });
  vi.stubGlobal('window', { open: h.open });
  vi.stubGlobal('navigator', { clipboard: { writeText: h.copy } });
});
afterEach(() => vi.unstubAllGlobals());

describe('ChatGPT guided custom connection', () => {
  it.each(['es', 'en'] as const)('shows the exact add action before leaving Riverz in %s', async locale => {
    h.locale = locale;
    await prepareChatgpt();
    expect(h.open).not.toHaveBeenCalled();
    expect(h.copy).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(render());
    expect(markup).toContain(locale === 'es' ? 'Crear aplicación MCP, la tercera opción' : 'Create MCP App, the third option');
    expect(markup).toContain(locale === 'es' ? 'Agregar, arriba a la derecha' : 'Add in the top right');
    expect(markup).toContain(MCP_URL);
    expect(markup).toContain('OAuth');
    expect(markup).not.toContain(translate(locale, 'oauth.check_verified'));
    expect(h.csrf.mock.calls[0][0]).toBe('/api/mcp/connection-check');
    expect(JSON.parse(h.csrf.mock.calls[0][1].body)).toEqual({ provider: 'chatgpt' });
    (button('oauth.copyAndOpenChatgpt').props.onClick as () => void)();
    expect(h.copy).toHaveBeenCalledWith(MCP_URL);
    expect(h.open).toHaveBeenCalledWith(CHATGPT_INSTALL_URL, '_blank', 'noopener,noreferrer');
    expect(h.events).toEqual(['copy', 'open']);
    expect(h.bank[2]).toBe('waiting');
  });
  it('keeps the URL and account restriction help when clipboard permission is denied', async () => {
    await prepareChatgpt();
    h.copy.mockRejectedValueOnce(new Error('Clipboard denied'));
    (button('oauth.copyAndOpenChatgpt').props.onClick as () => void)();
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.open).toHaveBeenCalledOnce();
    const markup = renderToStaticMarkup(render());
    expect(markup).toContain(MCP_URL);
    expect(markup).toContain('esa cuenta o espacio no tiene habilitadas');
    expect(h.bank[2]).toBe('waiting');
  });
  it('does not offer a handoff before the temporary user check exists', async () => {
    h.csrf.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await prepareChatgpt();
    expect(button('oauth.copyAndOpenChatgpt').props.disabled).toBe(true);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.bank[2]).toBe('error');
  });
  it('preserves the prefilled Claude handoff', async () => {
    const label = translate('es', 'oauth.connectWith', { client: 'Claude' });
    const target = nodes(render()).find(node => Array.isArray(node.props.children) && node.props.children.includes(label));
    expect(target).toBeDefined();
    (target!.props.onClick as () => void)();
    await vi.waitFor(() => expect(h.bank[3]).toBe(false));
    expect(h.open).toHaveBeenCalledWith(CLAUDE_INSTALL_URL, '_blank', 'noopener,noreferrer');
    expect(h.copy).not.toHaveBeenCalled();
  });
});
