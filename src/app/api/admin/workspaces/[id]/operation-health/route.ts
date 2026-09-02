import { adminGet } from '@/lib/admin/route';
import { safeSelect } from '@/lib/admin/queries';
import { supabaseAdmin } from '@/lib/channels/admin-client';

export const dynamic = 'force-dynamic';

/** Metadatos de preparación y rendimiento reciente, sin contenido de clientes. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await context.params;
  return adminGet(
    request,
    { action: 'view.workspace_operation_health', targetType: 'workspace', targetId: workspaceId },
    async () => {
      const admin = supabaseAdmin();
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [setup, validation, sent, failed, handoffs] = await Promise.all([
        safeSelect(admin, 'operacion_setup', 'prompt_version, perfil_actualizado_at')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
        safeSelect(admin, 'operacion_validation_runs', 'status, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        safeSelect(admin, 'ai_replies', 'id')
          .eq('workspace_id', workspaceId)
          .eq('status', 'sent')
          .gte('created_at', since),
        safeSelect(admin, 'ai_replies', 'id')
          .eq('workspace_id', workspaceId)
          .eq('status', 'failed')
          .gte('created_at', since),
        safeSelect(admin, 'conversations', 'id')
          .eq('workspace_id', workspaceId)
          .not('needs_human_at', 'is', null)
          .gte('needs_human_at', since),
      ]);
      return {
        profile: {
          configured: Boolean(setup.data),
          promptVersion: (setup.data as { prompt_version?: string | null } | null)?.prompt_version ?? null,
          updatedAt: (setup.data as { perfil_actualizado_at?: string | null } | null)?.perfil_actualizado_at ?? null,
        },
        validation: validation.data ?? null,
        last24h: {
          sent: sent.data?.length ?? 0,
          failed: failed.data?.length ?? 0,
          handoffs: handoffs.data?.length ?? 0,
        },
      };
    },
  );
}
