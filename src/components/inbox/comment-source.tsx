'use client';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import type { CommentSource } from '@/lib/comments/provenance';

export function CommentSourceCard({ source, privateReply, conversationId }: {
  source?: CommentSource;
  conversationId?: string;
  privateReply?: { conversationId: string; createdAt: string };
}) {
  const t = useT();
  if (!source && !privateReply) return null;
  return <div className="max-w-lg rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
    {source && <>
      <p className="line-clamp-2">{source.caption || t('inbox.sourcePostId', { id: source.postId })}</p>
      <div className="mt-1 flex flex-wrap gap-3">
        {source.conversationId !== conversationId && <Link className="text-primary hover:underline" href={`/bandeja?c=${source.conversationId}&t=${encodeURIComponent(source.createdAt)}`}>{t('inbox.openSourceComment')}</Link>}
        {source.permalink && <a className="hover:underline" href={source.permalink} target="_blank" rel="noopener noreferrer">{t('inbox.openSourcePost')}</a>}
      </div>
    </>}
    {privateReply && <Link className="text-primary hover:underline" href={`/bandeja?c=${privateReply.conversationId}&t=${encodeURIComponent(privateReply.createdAt)}`}>{t('inbox.openPrivateReply')}</Link>}
  </div>;
}
