import { describe, expect, it } from 'vitest';
import { isMetaCommentContextNotice } from './meta-comment-context';

describe('isMetaCommentContextNotice', () => {
  it('reconoce el aviso automático de Facebook', () => {
    expect(
      isMetaCommentContextNotice(
        'You are responding to a user comment to a post on your Page. View comment.(https://facebook.com/reel/2091451268173214/?comment_id=1586375946264346)',
      ),
    ).toBe(true);
  });

  it('no oculta mensajes reales aunque mencionen comentarios', () => {
    expect(isMetaCommentContextNotice('View comment')).toBe(false);
    expect(
      isMetaCommentContextNotice('Respondí tu comentario y te escribí por privado.'),
    ).toBe(false);
  });
});
