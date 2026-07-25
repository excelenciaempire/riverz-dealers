import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveIgReach, withinCommentWindow } from './engagement';

/**
 * La regla que se rompía en producción: un COMENTARIO no abre la ventana de
 * mensajería de 24h. A quien solo comentó hay que escribirle como respuesta
 * privada al comentario (7 días); un DM normal por su id lo rechaza Meta.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Supabase mínimo: devuelve conversaciones y mensajes según el canal pedido. */
function fakeDb(opts: {
  dmAt?: string;
  commentAt?: string;
  commentId?: string;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'conversations') {
        const rows = [
          ...(opts.dmAt ? [{ id: 'dm-conv', channel: 'instagram' }] : []),
          ...(opts.commentAt ? [{ id: 'c-conv', channel: 'ig_comment' }] : []),
        ];
        const q = {
          select: () => q,
          eq: () => q,
          in: () => Promise.resolve({ data: rows }),
        };
        return q;
      }
      // messages: la consulta filtra por conversation_id — devolvemos según cuál.
      let isComment = false;
      const q = {
        select: () => q,
        in: (_col: string, ids: string[]) => {
          isComment = ids.includes('c-conv');
          return q;
        },
        eq: () => q,
        not: () => q,
        order: () => q,
        limit: () =>
          Promise.resolve({
            data: isComment
              ? opts.commentAt
                ? [{ message_id: opts.commentId ?? 'comment-1', created_at: opts.commentAt }]
                : []
              : opts.dmAt
                ? [{ created_at: opts.dmAt }]
                : [],
          }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe('resolveIgReach', () => {
  it('usa DM libre cuando la persona escribió en las últimas 24h', async () => {
    const reach = await resolveIgReach(fakeDb({ dmAt: ago(2 * HOUR) }), 'c1');
    expect(reach.kind).toBe('dm');
  });

  it('usa respuesta privada cuando solo comentó (aunque sea reciente)', async () => {
    const reach = await resolveIgReach(
      fakeDb({ commentAt: ago(3 * HOUR), commentId: 'cmt-9' }),
      'c1',
    );
    expect(reach).toMatchObject({ kind: 'private_reply', commentId: 'cmt-9' });
  });

  it('cae a respuesta privada cuando el DM ya venció pero el comentario sigue vivo', async () => {
    const reach = await resolveIgReach(
      fakeDb({ dmAt: ago(3 * DAY), commentAt: ago(2 * DAY) }),
      'c1',
    );
    expect(reach.kind).toBe('private_reply');
  });

  it('no alcanza a nadie fuera de las dos ventanas', async () => {
    const reach = await resolveIgReach(fakeDb({ commentAt: ago(9 * DAY) }), 'c1');
    expect(reach).toMatchObject({ kind: 'none', reason: 'outside_comment_window' });
  });

  it('sin interacción no hay ruta de contacto', async () => {
    const reach = await resolveIgReach(fakeDb({}), 'c1');
    expect(reach).toMatchObject({ kind: 'none', reason: 'no_engagement' });
  });
});

describe('withinCommentWindow', () => {
  it('acepta 6 días y rechaza 8', () => {
    expect(withinCommentWindow(ago(6 * DAY))).toBe(true);
    expect(withinCommentWindow(ago(8 * DAY))).toBe(false);
    expect(withinCommentWindow(null)).toBe(false);
  });
});
