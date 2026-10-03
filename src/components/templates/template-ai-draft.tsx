'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function TemplateAiDraft({ language, category, onApply }: {
  language: string;
  category: string;
  onApply: (body: string) => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);

  const [agents, setAgents] = useState<{ id: string; label: string }[]>([]);

  const [agentId, setAgentId] = useState('');


  const [loadingContext, setLoadingContext] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const profileInitialised = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    setGenerating(false); setDraft(''); setSources([]);
  }, [language, category]);
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setLoadingContext(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetchWithCsrf('/api/whatsapp/templates/draft-context', { signal: request.signal });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.products) || !Array.isArray(result.agents)) throw new Error(t('templates.aiContextUnavailable'));
        if (!request.signal.aborted) {
          setAgents(result.agents);
          if (!profileInitialised.current) { setAgentId(result.agents.length === 1 ? result.agents[0].id : ''); profileInitialised.current = true; }
        }
      } catch {
        if (!request.signal.aborted) toast.error(t('templates.aiContextUnavailable'));
      } finally {
        if (!request.signal.aborted) setLoadingContext(false);
      }
    }, 250);
    return () => { clearTimeout(timer); request.abort(); };
  }, [open, fetchWithCsrf, t]);

  function changeOpen(next: boolean) {
    if (!next) {
      controller.current?.abort();
      controller.current = null;
      setGenerating(false);
    }
    setOpen(next);
  }

  async function generate() {
    if (!brief.trim() || generating) return;
    const request = new AbortController();
    controller.current = request;
    setGenerating(true);
    try {
      const response = await fetchWithCsrf('/api/whatsapp/templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: brief.trim(), language, category, agent_id: agentId || undefined, use_business_context: Boolean(agentId) }),
        signal: request.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('templates.aiFailed'));
      if (typeof result.body_text !== 'string' || !result.body_text.trim() || result.body_text.length > 1024) {
        throw new Error(t('templates.aiFailed'));
      }
      if (!request.signal.aborted) {
        setDraft(result.body_text);
        setSources(Array.isArray(result.sources) ? result.sources.map((source: { label: string }) => source.label).filter((label: unknown) => typeof label === 'string') : []);
      }
    } catch (error) {
      if (!request.signal.aborted) toast.error(error instanceof Error ? error.message : t('templates.aiFailed'));
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setGenerating(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button type="button" variant="ghost" size="sm" onClick={() => changeOpen(true)}>
        <Sparkles className="size-3.5" />{t('templates.aiWrite')}
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('templates.aiWrite')}</DialogTitle>
          <DialogDescription>{t('templates.aiDraftHelp')}</DialogDescription>
        </DialogHeader>

        {agents.length > 0 && <div className="space-y-2">
          <Label htmlFor="template-ai-profile">{t('templates.aiProfile')}</Label>
          <select id="template-ai-profile" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={agentId} disabled={generating}
            onChange={event => { setAgentId(event.target.value); setDraft(''); setSources([]); }}>
            <option value="">{t('templates.aiNoProfile')}</option>
            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
          </select>
        </div>}
        <div className="space-y-2">
          <Label htmlFor="template-ai-brief">{t('templates.aiBrief')}</Label>
          <Textarea id="template-ai-brief" value={brief} maxLength={2000} disabled={generating}
            onChange={(event) => { setBrief(event.target.value); setDraft(''); setSources([]); }} placeholder={t('templates.aiBriefPlaceholder')} />
        </div>
        {draft && (
          <div className="space-y-2">
            <Label htmlFor="template-ai-draft">{t('templates.aiDraft')}</Label>
            <Textarea id="template-ai-draft" value={draft} maxLength={1024} rows={6}
              disabled={generating} onChange={(event) => setDraft(event.target.value)} />
            {sources.length > 0 && <p className="text-xs text-muted-foreground">{t('templates.aiSources', { sources: sources.join(', ') })}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => void generate()} disabled={!brief.trim() || generating || loadingContext}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t('templates.aiGenerate')}
          </Button>
          {draft && <Button type="button" disabled={generating || !draft.trim()}
            onClick={() => { onApply(draft.trim()); changeOpen(false); }}>{t('templates.aiApply')}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
