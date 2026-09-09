import type { SupabaseClient } from '@supabase/supabase-js';
import { withAppsecretProof } from '@/lib/channels/meta-graph';
import { fetchMetaGraph } from '@/lib/channels/meta-fetch';
import { normalizeTemplateStatusEvent } from './template-webhooks';
import { reconcileWorkspaceAutomationReadiness } from '@/lib/automations/activation';

/** Refresh eligibility without overwriting local template content or buttons. */
export async function reconcileTemplateStatus(
  db: SupabaseClient,
  args: { workspaceId: string; wabaId: string; accessToken: string },
): Promise<number> {
  let url: string | null = `https://graph.facebook.com/v22.0/${args.wabaId}/message_templates?limit=100&fields=name,language,status,quality_score`;
  let updated = 0;
  for (let page = 0; url && page < 20; page++) {
    const response = await fetchMetaGraph(withAppsecretProof(url, args.accessToken), {
      headers: { Authorization: `Bearer ${args.accessToken}` },
    });
    if (!response.ok) throw new Error(`template_sync_http_${response.status}`);
    const body = await response.json() as {
      data?: Array<{ name: string; language: string; status: string; quality_score?: { score?: string } }>;
      paging?: { next?: string };
    };
    for (const template of body.data ?? []) {
      const status = normalizeTemplateStatusEvent(template.status);
      const { error } = await db.from('message_templates').update({
        meta_status: template.status,
        ...(status ? { status } : {}),
        ...(template.quality_score?.score ? { quality_score: template.quality_score.score } : {}),
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', args.workspaceId).eq('waba_id', args.wabaId)
        .eq('name', template.name).eq('language', template.language);
      if (error) throw new Error(error.message);
      updated++;
    }
    url = body.paging?.next ?? null;
  }
  if (url) throw new Error('template_sync_incomplete');
  await reconcileWorkspaceAutomationReadiness(db, args.workspaceId);
  return updated;
}
