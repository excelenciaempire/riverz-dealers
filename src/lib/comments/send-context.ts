import type { Conversation } from '@/types';
import type { CommentChannel } from './hilo';

/** The source case owns comment delivery, including its first private reply. */
export function commentSendContext(
  thread: { id: string } | null,
  channel: CommentChannel,
  commentId: string,
  postId?: string | null,
): Pick<Conversation, 'id' | 'thread_external_id'> {
  if (!thread?.id.trim() || !commentId.trim()) throw new Error('comment_send_context_unavailable');
  return {
    id: thread.id,
    thread_external_id: channel === 'tiktok_comment'
      ? `video:${postId ?? ''}|comment:${commentId}`
      : commentId,
  };
}
