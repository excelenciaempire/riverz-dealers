'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, ExternalLink, Loader2, Terminal } from 'lucide-react';
import { toast } from 'sonner';

import { useT } from '@/hooks/use-locale';
import {
  connectedClients,
  type McpClient,
  type OAuthConnectionToken,
} from '@/lib/mcp/connections';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MCP_URL = 'https://riverz.co/api/mcp';
const CLIENTS = {
  claude: {
    name: 'Claude Code',
    logo: '/logos/claude.ico',
    command: `claude mcp add --transport http --scope user riverz ${MCP_URL}\nclaude mcp login riverz`,
  },
  chatgpt: { name: 'ChatGPT (GPT)', logo: '/logos/openai.png', command: null },
  codex: {
    name: 'Codex (GPT)',
    logo: '/logos/codex.png',
    command: `codex mcp add riverz --url ${MCP_URL}\ncodex mcp login riverz`,
  },
} as const;

type Client = keyof typeof CLIENTS;

/** OAuth starts in the MCP client, which owns the callback and PKCE verifier. */
export function McpOauthConnect() {
  const t = useT();
  const [selected, setSelected] = useState<Client | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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
        {(Object.keys(CLIENTS) as Client[]).map((id) => (
          <Button
            key={id}
            variant="outline"
            onClick={() => {
              setCopied(null);
              setSelected(id);
            }}
          >
            <Image
              src={CLIENTS[id].logo}
              alt=""
              width={20}
              height={20}
              unoptimized
              className={
                id === 'codex'
                  ? 'size-5 rounded-sm bg-black'
                  : 'size-5 rounded-sm'
              }
            />
            {t('oauth.connectClient', { client: CLIENTS[id].name })}
            {connected.has(id) && (
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
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('oauth.connectClient', { client: client?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('oauth.clientStartsLogin')}
            </DialogDescription>
          </DialogHeader>
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
          {client?.command ? (
            <ol className="list-decimal space-y-4 pl-5 text-sm">
              <li>
                <p>{t('oauth.runCommand')}</p>
                <pre className="border-border bg-muted/40 mt-2 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed">
                  {client.command}
                </pre>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => void copy(client.command!)}
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
          ) : (
            <ol className="list-decimal space-y-4 pl-5 text-sm">
              <li>
                <p>{t('oauth.chatgptDeveloperMode')}</p>
                <Button
                  className="mt-2"
                  variant="outline"
                  render={
                    <a
                      href="https://chatgpt.com/plugins"
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  nativeButton={false}
                >
                  {t('oauth.openChatgpt')}
                  <ExternalLink />
                </Button>
              </li>
              <li>
                <p>{t('oauth.chatgptAddServer')}</p>
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
              </li>
              <li>{t('oauth.authorizeInBrowser')}</li>
            </ol>
          )}
          {selected === 'claude' && (
            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
              {t('oauth.claudeMcpFallback')}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
