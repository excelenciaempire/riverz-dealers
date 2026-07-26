'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, PhoneCall, Play, Pause } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { VoiceCampaign } from '@/types';

type Agent = { id: string; name: string };
type Segment = { id: string; name: string };

export default function VoiceCampaignsPage() {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [campaigns, setCampaigns] = useState<VoiceCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', agent_id: '', segment_id: '', objective: '' });

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    const supabase = createClient();
    const [{ data: ag }, { data: seg }] = await Promise.all([
      supabase
        .from('ai_agents')
        .select('id, name')
        .eq('workspace_id', workspace.id)
        .eq('voice_enabled', true)
        .is('deleted_at', null),
      supabase.from('contact_segments').select('id, name').eq('workspace_id', workspace.id),
    ]);
    setAgents((ag ?? []) as Agent[]);
    setSegments((seg ?? []) as Segment[]);
    const res = await fetch(`/api/voice/campaigns?workspace_id=${workspace.id}`, {
      cache: 'no-store',
    });
    if (res.ok) setCampaigns((await res.json()).campaigns ?? []);
    setLoading(false);
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(start: boolean) {
    if (!workspace?.id || !form.name.trim() || !form.agent_id || !form.segment_id) {
      toast.error(t('voice.campaignMissing'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/voice/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          call_type: 'manual',
          ...form,
          start,
        }),
      });
      if (!res.ok) {
        toast.error((await res.json()).error ?? t('voice.campaignError'));
        return;
      }
      setForm({ name: '', agent_id: '', segment_id: '', objective: '' });
      toast.success(start ? t('voice.campaignStarted') : t('voice.campaignSaved'));
      load();
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: 'running' | 'paused') {
    if (!workspace?.id) return;
    await fetchWithCsrf('/api/voice/campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, workspace_id: workspace.id, status }),
    });
    load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-2">
        <PhoneCall className="h-5 w-5 text-yellow-500" />
        <h1 className="text-2xl font-bold text-foreground">{t('voice.campaignsTitle')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('voice.campaignsHint')}</p>

      {/* Create */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <Input
          placeholder={t('voice.campaignName')}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            value={form.agent_id}
            onChange={(e) => setForm({ ...form, agent_id: e.target.value })}
            className="rounded-md border border-border bg-muted px-2 py-2 text-sm text-foreground"
          >
            <option value="">{t('voice.campaignPickAgent')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={form.segment_id}
            onChange={(e) => setForm({ ...form, segment_id: e.target.value })}
            className="rounded-md border border-border bg-muted px-2 py-2 text-sm text-foreground"
          >
            <option value="">{t('voice.campaignPickSegment')}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <Textarea
          placeholder={t('voice.campaignObjective')}
          value={form.objective}
          onChange={(e) => setForm({ ...form, objective: e.target.value })}
          className="min-h-16"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => create(false)} disabled={saving}>
            {t('voice.campaignSaveDraft')}
          </Button>
          <Button onClick={() => create(true)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('voice.campaignStart')}
          </Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.status} · {c.stats?.enqueued ?? 0}/{c.stats?.total ?? '—'}
                </p>
              </div>
              {c.status === 'running' ? (
                <Button size="sm" variant="ghost" onClick={() => setStatus(c.id, 'paused')}>
                  <Pause className="h-4 w-4" />
                </Button>
              ) : c.status === 'draft' || c.status === 'paused' ? (
                <Button size="sm" variant="ghost" onClick={() => setStatus(c.id, 'running')}>
                  <Play className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
