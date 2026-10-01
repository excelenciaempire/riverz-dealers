import { z } from 'zod';
import { csrfGuard } from '@/lib/csrf';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { driveBody, driveFailure, driveRateLimited, driveReply, driveSession } from '@/lib/ai/drive-server';
import { parseDriveFile } from '@/lib/ai/drive-provider';
import { limitByKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), file: z.string().trim().min(1).max(2048) }).strict(),
  z.object({ action: z.enum(['remove','retry']), id: z.string().uuid(), revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('disconnect') }).strict(),
]);
export async function GET(request: Request, { params }: Context) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return driveReply({ error: 'not_found' }, 404);
  try {
    if (new URL(request.url).search) return driveFailure({ message: 'document_invalid' });
    const ctx = await driveSession((await params).id); if (!ctx) return driveFailure({ message: 'invalid_document_context' });
    const selected = await ctx.db.rpc('manage_ai_drive_source', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.actorId, p_agent_id: ctx.agentId, p_action: 'list' });
    if (selected.error) return driveFailure(selected.error);
    return driveReply(selected.data);
  } catch (error) { return driveFailure(error); }
}
export async function POST(request: Request, { params }: Context) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return driveReply({ error: 'not_found' }, 404);
  const block = await csrfGuard(request); if (block) return block;
  try {
    const ctx = await driveSession((await params).id); if (!ctx) return driveFailure({ message: 'invalid_document_context' });
    const limit = await limitByKey(`drive:manage:${ctx.workspaceId}`, { limit: 60, windowMs: 3_600_000 });
    if (!limit.success) return driveRateLimited(limit.reset);
    const text = await driveBody(request);
    const body = input.safeParse(JSON.parse(text)); if (!body.success) return driveFailure({ message: 'document_invalid' });
    const value = body.data, fileId = value.action === 'add' ? parseDriveFile(value.file) : null;
    if (value.action === 'add' && !fileId) return driveFailure({ message: 'document_invalid' });
    const changed = await ctx.db.rpc('manage_ai_drive_source', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.actorId, p_agent_id: ctx.agentId,
      p_action: value.action, p_file_id: fileId, p_id: 'id' in value ? value.id : null, p_revision: 'revision' in value ? value.revision : null });
    if (changed.error) return driveFailure(changed.error);
    return driveReply(changed.data);
  } catch (error) { return driveFailure(error instanceof SyntaxError ? { message: 'document_invalid' } : error); }
}
