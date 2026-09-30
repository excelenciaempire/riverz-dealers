'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Monitor,
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';

import { useT } from '@/hooks/use-locale';
import {
  connectedClients,
  type McpClient,
  type OAuthConnectionToken,
} from '@/lib/mcp/connections';
import { Button } from '@/components/ui/button';
import {
  CHATGPT_SETTINGS_URL,
  desktopSetupUrl,
  MCP_SETUP_COMMANDS,
  MCP_URL,
} from '@/lib/mcp/setup';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const CLIENTS = {
  claude: {
    name: 'Claude Code',
    command: MCP_SETUP_COMMANDS.claude,
  },
  chatgpt: { name: 'ChatGPT', command: null },
  codex: {
    name: 'Codex',
    command: MCP_SETUP_COMMANDS.codex,
  },
} as const;

type Client = keyof typeof CLIENTS;
const PROVIDERS = [
  { name: 'Claude Code', logo: '/logos/claude.ico', clients: ['claude'] },
  {
    name: 'OpenAI',
    logo: '/logos/codex.png',
    clients: ['codex', 'chatgpt'],
  },
] as const;

/** OAuth starts in the MCP client, which owns the callback and PKCE verifier. */
export function McpOauthConnect() {
  const t = useT();
  const [selected, setSelected] = useState<Client | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [connected, setConnected] = useState<Set<McpClient>>(new Set());
  const [statusFailed, setStatusFailed] = useState(false);
  const client = selected ? CLIENTS[selected] : null;

  useEffect(() => {
    let active = true;
    const checkConnection = async () => {
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
    void checkConnection();
    const timer = selected
      ? window.setInterval(() => void checkConnection(), 4000)
      : null;
    window.addEventListener('focus', checkConnection);
    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('focus', checkConnection);
    };
  }, [selected]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      toast.error(t('oauth.copyFailed'));
    }
  };

  return (
    <section className="border-border space-y-3 border-b pb-6">
      <div>
        <h3 className="text-sm font-medium">{t('oauth.connectTitle')}</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('oauth.connectDescription')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((provider) => (
          <Button
            key={provider.name}
            variant="outline"
            onClick={() => {
              setCopied(null);
              setStarted(false);
              setSelected(provider.clients[0]);
            }}
          >
            <Image
              src={provider.logo}
              alt=""
              width={20}
              height={20}
              unoptimized
              className={
                provider.clients[0] === 'codex'
                  ? 'size-5 rounded-sm bg-black'
                  : 'size-5 rounded-sm'
              }
            />
            {t('oauth.connectClient', { client: provider.name })}
            {provider.clients.some((id) => connected.has(id)) && (
              <Check
                className="size-3.5 text-emerald-600"
                aria-label={t('oauth.connected')}
              />
            )}
          </Button>
        ))}
      </div>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setStarted(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('oauth.connectClient', {
                client: selected === 'claude' ? 'Claude Code' : 'OpenAI',
              })}
            </DialogTitle>
            <DialogDescription>
              {t('oauth.clientStartsLogin')}
            </DialogDescription>
          </DialogHeader>
          {selected && selected !== 'claude' && (
            <fieldset className="flex gap-2">
              <legend className="sr-only">
                {t('oauth.chooseOpenaiClient')}
              </legend>
              {(['codex', 'chatgpt'] as const).map((id) => (
                <Button
                  key={id}
                  size="sm"
                  variant={selected === id ? 'default' : 'outline'}
                  aria-pressed={selected === id}
                  onClick={() => {
                    setCopied(null);
                    setStarted(false);
                    setSelected(id);
                  }}
                >
                  {id === 'chatgpt' ? t('oauth.chatgptWeb') : CLIENTS[id].name}
                </Button>
              ))}
            </fieldset>
          )}
          {selected && (connected.has(selected) || started) && (
            <div
              role="status"
              className="text-muted-foreground flex items-center gap-2 text-xs"
            >
              {selected && connected.has(selected) ? (
                <>
                  <Check className="size-4 text-emerald-600" />
                  {t('oauth.connected')}
                </>
              ) : statusFailed ? (
                t('oauth.statusFailed')
              ) : (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {t('oauth.waitingForClient')}
                </>
              )}
            </div>
          )}
          {client?.command && selected && selected !== 'chatgpt' ? (
            <div className="min-w-0 space-y-4">
              <Button
                className="h-auto min-h-8 w-full py-2 whitespace-normal"
                onClick={() => setStarted(true)}
                render={
                  <a
                    href={desktopSetupUrl(
                      selected,
                      t('oauth.desktopSetupRequest', {
                        client: client.name,
                        url: MCP_URL,
                        commands: client.command,
                      })
                    )}
                  />
                }
                nativeButton={false}
              >
                <Monitor />
                {t('oauth.openDesktop', { client: client.name })}
              </Button>
              <ol className="min-w-0 list-decimal space-y-2 pl-5 text-sm">
                <li>{t('oauth.sendSetupRequest')}</li>
                <li>{t('oauth.authorizeInBrowser')}</li>
              </ol>
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer">
                  {t('oauth.desktopFallback')}
                </summary>
                <ol className="mt-3 min-w-0 list-decimal space-y-4 pl-5">
                  <li>
                    <p>{t('oauth.runCommand')}</p>
                    <pre className="border-border bg-muted/40 mt-2 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed">
                      {client.command}
                    </pre>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setStarted(true);
                        void copy(client.command!);
                      }}
                    >
                      {copied === client.command ? <Check /> : <Copy />}
                      {t(
                        copied === client.command
                          ? 'oauth.copied'
                          : 'oauth.copyCommand'
                      )}
                    </Button>
                  </li>
                  <li>{t('oauth.authorizeInBrowser')}</li>
                </ol>
                {selected === 'claude' && (
                  <p className="text-muted-foreground mt-3 flex items-start gap-2 text-xs">
                    <Terminal
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {t('oauth.claudeMcpFallback')}
                  </p>
                )}
              </details>
            </div>
          ) : (
            <ol className="min-w-0 list-decimal space-y-4 pl-5 text-sm">
              <li>
                <p>{t('oauth.chatgptDeveloperMode')}</p>
                <Button
                  className="mt-2 h-auto min-h-8 max-w-full py-2 text-left whitespace-normal"
                  variant="outline"
                  onClick={() => {
                    setStarted(true);
                    void copy(MCP_URL);
                  }}
                  render={
                    <a
                      href={CHATGPT_SETTINGS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  nativeButton={false}
                >
                  {t('oauth.copyAndOpenChatgpt')}
                  <ExternalLink />
                </Button>
              </li>
              <li>
                <p>{t('oauth.chatgptAddServer')}</p>
                <p className="mt-2 font-medium">
                  {t('oauth.serverName')}: Riverz
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('oauth.serverDescription')}
                </p>
                <div className="border-border bg-muted/40 mt-2 flex items-center gap-2 rounded-lg border p-2">
                  <code className="min-w-0 flex-1 text-xs break-all">
                    {MCP_URL}
                  </code>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={t('oauth.copyUrl')}
                    onClick={() => void copy(MCP_URL)}
                  >
                    {copied === MCP_URL ? <Check /> : <Copy />}
                  </Button>
                </div>
                {copied === MCP_URL && (
                  <p
                    role="status"
                    className="text-muted-foreground mt-1 text-xs"
                  >
                    {t('oauth.urlCopied')}
                  </p>
                )}
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('oauth.authentication')}: OAuth
                </p>
              </li>
              <li>{t('oauth.authorizeInBrowser')}</li>
              <li className="list-none">
                <details className="-ml-5">
                  <summary className="text-muted-foreground cursor-pointer">
                    {t('oauth.noCreateOption')}
                  </summary>
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t('oauth.chatgptAccountRequirement')}
                  </p>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCopied(null);
                      setStarted(false);
                      setSelected('codex');
                    }}
                  >
                    <Monitor />
                    {t('oauth.useDesktop')}
                  </Button>
                </details>
              </li>
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
