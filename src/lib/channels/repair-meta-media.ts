import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageAttachment } from '@/types';

export function missingMediaText(value: string | null | undefined): boolean {
  return !value?.trim() || /^\[(unsupported(?: media)?|archivo no disponible|imagen|video|audio|archivo)\]$/i.test(value.trim());
}

/** Replace a proved missing attachment in place. No outbound/AI dispatch. */
export async function repairStoredMetaMedia(db: SupabaseClient, args: {
  workspaceId: string; externalMessageId: string; channel: string;
  media: MessageAttachment[]; text?: string;
}): Promise<boolean> {
  const first = args.media[0];
  if (!first?.url) return false;
  const { data: rows } = await db.from('messages')
    .select('id, content_text, conversation_id, conversations!inner(workspace_id, deleted_at)')
    .eq('message_id', args.externalMessageId).eq('channel', args.channel)
    .eq('conversations.workspace_id', args.workspaceId).is('conversations.deleted_at', null)
    .is('deleted_at', null).is('media_url', null).limit(2);
  if (rows?.length !== 1 || !missingMediaText(rows[0].content_text)) return false;
  const m = rows[0];
  const mime = first.mime_type ?? 'application/octet-stream';
  const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video'
    : mime.startsWith('audio/') ? 'audio' : 'document';
  let update = db.from('messages').update({ attachments: args.media, media_url: first.url,
    media_mime: mime, media_type: kind, media_size: first.size ?? null,
    content_type: kind, content_text: args.text ?? '' })
    .eq('id', m.id).is('media_url', null).is('deleted_at', null);
  update = m.content_text === null ? update.is('content_text', null) : update.eq('content_text', m.content_text);
  const result = await update.select('id');
  return !result.error && !!result.data?.length;
}
