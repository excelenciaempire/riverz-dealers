import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { findMessageByExternalId } from './message-lookup';
import { ingestInboundEvent } from './inbox-writer';

/**
 * Comentario histórico enumerado desde Meta Business Suite.
 *
 * Meta puede mostrar un comentario de anuncio en Business Suite aunque el
 * edge masivo de Graph no lo enumere. El `commentId` sigue siendo un id real
 * de Graph y es la clave de deduplicación; esta entrada no debe usarse para
 * contenido que no pertenezca a la conexión seleccionada.
 */
export interface BusinessSuiteComment {
  commentId: string;
  postId: string;
  authorName?: string | null;
  text: string;
  createdAt: string;
  permalink?: string | null;
}

export interface BusinessSuiteImportResult {
  imported: number;
  alreadyPresent: number;
  skipped: number;
}

/** Evita una corrida serial interminable sin saturar la base ni el inbox. */
const IMPORT_CONCURRENCY = 4;

/**
 * Guarda una lectura histórica y pasiva de Business Suite. Nunca despierta
 * reglas, IA, mensajes ni respuestas automáticas.
 *
 * Business Suite no expone el id del autor en todos los comentarios de
 * anuncios. En ese caso se usa una identidad aislada por comentario: es mejor
 * no fusionar por nombre a dos personas diferentes. Si Graph entrega luego
 * el evento normal, el `commentId` evita duplicar el mensaje.
 */
export async function importBusinessSuiteComments(
  db: SupabaseClient,
  connection: ChannelConnection,
  comments: readonly BusinessSuiteComment[]
): Promise<BusinessSuiteImportResult> {
  if (connection.channel !== 'fb_comment') {
    throw new Error('business_suite_requires_facebook_comments_connection');
  }

  let imported = 0;
  let alreadyPresent = 0;
  let skipped = 0;
  const seen = new Set<string>();

  const candidates: BusinessSuiteComment[] = [];
  for (const comment of comments) {
    const commentId = comment.commentId.trim();
    const postId = comment.postId.trim();
    const text = comment.text.trim();
    const receivedAt = new Date(comment.createdAt);
    if (
      !commentId ||
      !postId ||
      !text ||
      !Number.isFinite(receivedAt.getTime()) ||
      seen.has(commentId)
    ) {
      skipped++;
      continue;
    }
    seen.add(commentId);
    candidates.push(comment);
  }

  for (let offset = 0; offset < candidates.length; offset += IMPORT_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + IMPORT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (comment) => {
        const commentId = comment.commentId.trim();
        const postId = comment.postId.trim();
        const text = comment.text.trim();
        const receivedAt = new Date(comment.createdAt);
        // `ingestInboundEvent` deduplica dentro de un hilo. Este chequeo previo
        // cubre también una llegada posterior del mismo comentario vía webhook,
        // que puede llevar el id real del autor en vez del fallback histórico.
        const existing = await findMessageByExternalId(db, {
          workspaceId: connection.workspace_id,
          channel: 'fb_comment',
          externalMessageId: commentId,
        });
        if (existing) return 'alreadyPresent' as const;

        const written = await ingestInboundEvent(db, {
          channel: 'fb_comment',
          connection,
          externalContactId: `business-suite-comment:${commentId}`,
          contactName: comment.authorName?.trim() || undefined,
          externalMessageId: commentId,
          text,
          comment: {
            postId,
            permalink: comment.permalink?.trim() || undefined,
          },
          receivedAt: receivedAt.toISOString(),
          suppressAutoReply: true,
          raw: { source: 'meta_business_suite_history' },
        });
        return written ? ('imported' as const) : ('alreadyPresent' as const);
      })
    );
    for (const result of results) {
      if (result === 'imported') imported++;
      else alreadyPresent++;
    }
  }

  return { imported, alreadyPresent, skipped };
}
