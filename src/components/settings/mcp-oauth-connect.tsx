'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Monitor,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { Button } from '@/components/ui/button';
import {
  connectedClients,
  type McpClient,
  type OAuthConnectionToken,
} from '@/lib/mcp/connections';
import {
  CHATGPT_INSTALL_URL,
  CLAUDE_INSTALL_URL,
  desktopSetupUrl,
  editorInstallUrl,
  MCP_SETUP_COMMANDS,
  MCP_URL,
} from '@/lib/mcp/setup';

const ASSISTANTS = [
  {
    name: 'Claude',
    logo: '/logos/claude.ico',
    href: CLAUDE_INSTALL_URL,
    clients: ['claude-chat', 'claude'],
    description: 'oauth.claudeCard',
  },
  {
    name: 'ChatGPT',
    logo: '/logos/openai.png',
    href: CHATGPT_INSTALL_URL,
    clients: ['chatgpt', 'codex'],
    description: 'oauth.chatgptCard',
  },
] as const;
type Assistant = (typeof ASSISTANTS)[number];

/** The assistant owns OAuth. Opening a link is never proof of connection. */
export function McpOauthConnect() {
  const t = useT();
  const [selected, setSelected] = useState<Assistant | null>(null);
  const [connected, setConnected] = useState<Set<McpClient>>(new Set());
  const [statusFailed, setStatusFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const selectedConnected = selected && connected.has(selected.clients[0]);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch('/api/mcp/tokens', {
          cache: 'no-store',
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) throw new Error('connection_status_failed');
        const data = await response.json();
        if (active) {
          setConnected(
            connectedClients((data.tokens ?? []) as OAuthConnectionToken[])
          );
          setStatusFailed(false);
        }
      } catch {
        if (active) {
          setConnected(new Set());
          setStatusFailed(true);
        }
      }
    };
    void check();
    const timer =
      selected && !selectedConnected
        ? window.setInterval(() => void check(), 4000)
        : null;
    window.addEventListener('focus', check);
    window.addEventListener('mcp-connections-changed', check);
    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('mcp-connections-changed', check);
    };
  }, [selected, selectedConnected]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopied(true);
    } catch {
      toast.error(t('oauth.copyFailed'));
    }
  };

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium">{t('oauth.connectTitle')}</h3>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        {ASSISTANTS.map((assistant) => (
          <div
            key={assistant.name}
            className="border-border flex min-w-0 flex-col gap-4 rounded-xl border p-4"
          >
            <div className="flex items-start gap-3">
              <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                <Image
                  src={assistant.logo}
                  alt=""
                  width={28}
                  height={28}
                  unoptimized
                  className="size-7 rounded-sm"
                />
              </div>
              <div>
                <h4 className="text-sm font-medium">{assistant.name}</h4>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t(assistant.description)}
                </p>
              </div>
            </div>
            <Button
              className="mt-auto h-9 w-full"
              variant="outline"
              render={
                <a
                  href={assistant.href}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              nativeButton={false}
              onClick={() => {
                setSelected(assistant);
                setCopied(false);
                if (assistant.name === 'ChatGPT') void copyUrl();
              }}
            >
              {connected.has(assistant.clients[0]) ? (
                <Check className="text-emerald-600" />
              ) : (
                <ExternalLink />
              )}
              {t(
                connected.has(assistant.clients[0])
                  ? 'oauth.manageClient'
                  : 'oauth.connectClient',
                { client: assistant.name }
              )}
            </Button>
          </div>
        ))}
      </div>
      {selected && (
        <div className="border-border bg-muted/30 max-w-2xl space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium" role="status">
              {selectedConnected
                ? t('oauth.connectedClient', { client: selected.name })
                : t('oauth.finishClient', { client: selected.name })}
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('oauth.closeHelp')}
              onClick={() => setSelected(null)}
            >
              <X />
            </Button>
          </div>
          {!selectedConnected &&
            (selected.name === 'Claude' ? (
              <p className="text-muted-foreground text-sm">
                {t('oauth.claudeQuickSteps')}
              </p>
            ) : (
              <>
                <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
                  <li>{t('oauth.chatgptQuickOpen')}</li>
                  <li>{t('oauth.chatgptQuickAdd')}</li>
                  <li>{t('oauth.chatgptQuickAuthorize')}</li>
                </ol>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <code className="min-w-0 text-xs break-all select-all">
                    {MCP_URL}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copyUrl()}
                  >
                    {copied ? <Check /> : <Copy />}
                    {t(copied ? 'oauth.copied' : 'oauth.copyUrl')}
                  </Button>
                </div>
                <details className="text-xs">
                  <summary className="text-muted-foreground cursor-pointer">
                    {t('oauth.noCreateOption')}
                  </summary>
                  <p className="text-muted-foreground mt-2">
                    {t('oauth.chatgptDeveloperMode')}
                  </p>
                </details>
              </>
            ))}
          {!selectedConnected && (
            <p className="text-muted-foreground text-xs">
              {t(
                statusFailed ? 'oauth.statusFailed' : 'oauth.connectionReturn'
              )}
            </p>
          )}
        </div>
      )}
      <details className="group max-w-2xl text-sm">
        <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1.5 py-1 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          {t('oauth.otherAssistants')}
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['cursor', 'vscode'] as const).map((id) => (
            <Button
              key={id}
              variant="outline"
              render={<a href={editorInstallUrl(id)} />}
              nativeButton={false}
            >
              <Monitor />
              {t('oauth.connectClient', {
                client: id === 'cursor' ? 'Cursor' : 'VS Code',
              })}
            </Button>
          ))}
        </div>
      </details>
    </section>
  );
}

export function McpCodingSetup() {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {(['claude', 'codex'] as const).map((id) => {
        const name = id === 'claude' ? 'Claude Code' : 'Codex';
        const commands = MCP_SETUP_COMMANDS[id];
        return (
          <details
            key={id}
            className="border-border rounded-lg border p-3 text-sm"
          >
            <summary className="cursor-pointer font-medium">
              <span className="inline-flex items-center gap-2 align-middle">
                <Image
                  src={
                    id === 'claude' ? '/logos/claude.ico' : '/logos/codex.png'
                  }
                  alt=""
                  width={20}
                  height={20}
                  unoptimized
                  className="size-5 rounded-sm"
                />
                {name}
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {id === 'claude' && (
                <p className="text-muted-foreground text-xs">
                  {t('oauth.claudeSharedConnection')}
                </p>
              )}
              <Button
                variant="outline"
                render={
                  <a
                    href={desktopSetupUrl(
                      id,
                      t('oauth.desktopSetupRequest', {
                        client: name,
                        url: MCP_URL,
                        commands,
                      })
                    )}
                  />
                }
                nativeButton={false}
              >
                <Monitor />
                {t('oauth.openDesktop', { client: name })}
              </Button>
              <p className="text-muted-foreground text-xs">
                {t('oauth.sendSetupRequest')}
              </p>
              <pre className="bg-muted/40 overflow-x-auto rounded-lg p-3 text-xs">
                {commands}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(commands);
                    setCopied(id);
                  } catch {
                    toast.error(t('oauth.copyFailed'));
                  }
                }}
              >
                {copied === id ? <Check /> : <Copy />}
                {t(copied === id ? 'oauth.copied' : 'oauth.copyCommand')}
              </Button>
              {id === 'claude' && (
                <p className="text-muted-foreground text-xs">
                  {t('oauth.claudeMcpFallback')}
                </p>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
