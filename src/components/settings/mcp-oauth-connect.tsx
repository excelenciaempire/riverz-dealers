'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';
import { CHATGPT_INSTALL_URL, CLAUDE_INSTALL_URL, MCP_URL, MCP_SETUP_COMMANDS } from '@/lib/mcp/setup';

type Provider = 'chatgpt' | 'claude' | 'codex';
type Status = 'waiting' | 'authorized' | 'verified' | 'expired' | 'error';
const CLIENTS = {
  chatgpt: { name: 'ChatGPT', logo: '/logos/openai.png', url: CHATGPT_INSTALL_URL },
  claude: { name: 'Claude', logo: '/logos/claude.ico', url: CLAUDE_INSTALL_URL },
  codex: { name: 'Codex', logo: '/logos/codex.png', url: CHATGPT_INSTALL_URL },
};

/** Only a user-scoped, authenticated tool call can complete the three steps. */
export function McpOauthConnect() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [check, setCheck] = useState<{ id: string; expires_at: string } | null>(null);
  const [status, setStatus] = useState<Status>('waiting');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const expired = status === 'expired';
  async function copy(value: string, key: string) {
    try { await navigator.clipboard.writeText(value); setCopied(key); }
    catch { toast.error(t('oauth.copyFailed')); }
  }
  function openClient(id: Provider) {
    // Request clipboard access before the new tab takes focus.
    if (id === 'chatgpt') void copy(MCP_URL, 'url');
    window.open(CLIENTS[id].url, '_blank', 'noopener,noreferrer');
  }
  async function start(id: Provider, open = true) {
    if (busy) return;
    if (open) openClient(id);
    setProvider(id); setCheck(null); setStatus('waiting'); setBusy(true);
    try {
      const response = await fetchWithCsrf('/api/mcp/connection-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: id }),
      });
      if (!response.ok) throw new Error('check_failed');
      setCheck(await response.json());
    } catch { setStatus('error'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!check || expired) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/mcp/connection-check?id=${encodeURIComponent(check.id)}`, {
          cache: 'no-store', signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) throw new Error('check_failed');
        const data = await response.json();
        if (active) setStatus(data.status);
      } catch { if (active) setStatus('error'); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    window.addEventListener('focus', poll);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [check, expired]);
  const client = provider ? CLIENTS[provider] : null;
  const prompt = check ? t('oauth.verifyPrompt', { code: check.id }) : '';
  return (
    <section className="max-w-2xl space-y-4">
      <h3 className="text-sm font-medium">{t('oauth.connectTitle')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['chatgpt', 'claude'] as const).map(id => (
          <Button key={id} className="h-12 justify-start gap-3" variant="outline" disabled={busy} onClick={() => void start(id, id === 'claude')}>
            <Image src={CLIENTS[id].logo} alt="" width={24} height={24} unoptimized className="size-6 rounded-sm" />
            {t('oauth.connectWith', { client: CLIENTS[id].name })}{id === 'claude' && <ExternalLink className="ml-auto" />}
          </Button>
        ))}
      </div>
      {provider && client && (
        <div className="border-border space-y-4 rounded-xl border p-4">
          <p role="status" className="text-sm font-medium">{busy ? <Loader2 className="inline size-4 animate-spin" /> : t(`oauth.check_${status}`)}</p>
          <ol className="space-y-5 text-sm">
            <li className="space-y-2">
              <p className="font-medium">1. {t('oauth.stepAdd')}</p>
              <p className="text-muted-foreground">{t('oauth.reuseExisting')}</p>
              <p className="text-muted-foreground">{t(provider === 'claude' ? 'oauth.addClaudeExact' : provider === 'codex' ? 'oauth.addCodexExact' : 'oauth.addChatgptExact')}</p>
              {provider === 'chatgpt' && <p className="text-muted-foreground">{t('oauth.chatgptConnectionFields')}</p>}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <code className="min-w-0 break-all text-xs select-all">{MCP_URL}</code>
                <Button size="sm" variant="outline" onClick={() => void copy(MCP_URL, 'url')}>{copied === 'url' ? <Check /> : <Copy />}{t('oauth.copyUrl')}</Button>
              </div>
              {provider !== 'codex' && <Button variant={provider === 'chatgpt' ? 'default' : 'outline'} disabled={busy || !check} onClick={() => openClient(provider)} className="h-auto min-h-9 whitespace-normal text-left">
                {t(provider === 'chatgpt' ? 'oauth.copyAndOpenChatgpt' : 'oauth.openClient', { client: client.name })}<ExternalLink className="size-3" />
              </Button>}
              {provider === 'chatgpt' && <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">{t('oauth.chatgptMissingOption')}</summary>
                <p className="mt-2 text-muted-foreground">{t('oauth.chatgptMissingOptionHelp')}</p>
              </details>}
            </li>
            <li className="space-y-2">
              <p className="font-medium">2. {t('oauth.stepAuthorize')}</p>
              <p className="text-muted-foreground">{t(provider === 'claude' ? 'oauth.signInNow' : 'oauth.authorizeExact')}</p>
              {provider === 'claude' && <p className="text-muted-foreground text-xs">{t('oauth.trustNotice')}</p>}
            </li>
            <li className="space-y-2">
              <p className="font-medium">3. {t('oauth.stepVerify')}</p>
              {status === 'verified' ? <p className="flex items-center gap-2 text-emerald-600"><Check className="size-4" />{t('oauth.realCallVerified')}</p> : <>
                <p className="text-muted-foreground">{t('oauth.verifyExact', { client: client.name })}</p>
                {check && !expired && <>
                  <p className="rounded-lg bg-muted p-3 text-xs break-words select-all">{prompt}</p>
                  <Button size="sm" variant="outline" onClick={() => void copy(prompt, 'prompt')}>{copied === 'prompt' ? <Check /> : <Copy />}{t('oauth.copyCheck')}</Button>
                </>}
              </>}
            </li>
          </ol>
          {(status === 'error' || expired) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void start(provider, false)}>{t('oauth.retryCheck')}</Button>}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{t('oauth.surfaceLimits')}</summary>
            <div className="mt-2 space-y-2 text-muted-foreground">
              <p>{t(provider === 'claude' ? 'oauth.claudeLimits' : 'oauth.openaiLimits')}</p>
              <p>{t('oauth.planLimits')}</p>
              {provider !== 'claude' && <Button size="sm" variant="outline" onClick={() => void start('codex', false)}>{t('oauth.useClient', { client: 'Codex' })}</Button>}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

export function McpCodingSetup() {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  return <div className="space-y-3">
    <p className="text-muted-foreground text-xs">{t('oauth.localSeparate')}</p>
    {(['codex', 'claude'] as const).map(id => <details key={id} className="border-border rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{id === 'codex' ? 'Codex' : 'Claude Code'}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground text-xs">{t(id === 'codex' ? 'oauth.addCodexExact' : 'oauth.claudeLimits')}</p>
        <p className="text-muted-foreground text-xs">{t('oauth.reuseExisting')}</p>
        <pre className="bg-muted/40 overflow-x-auto rounded-lg p-3 text-xs">{MCP_SETUP_COMMANDS[id]}</pre>
        <Button size="sm" variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(MCP_SETUP_COMMANDS[id]); setCopied(id); }
          catch { toast.error(t('oauth.copyFailed')); }
        }}>{copied === id ? <Check /> : <Copy />}{t('oauth.copyCommand')}</Button>
      </div>
    </details>)}
  </div>;
}
