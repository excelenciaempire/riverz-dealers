import { describe, expect, it } from 'vitest';
import { addCommentContextToPrivateReply } from './private-reply-context';

describe('addCommentContextToPrivateReply', () => {
  it('abre el privado recordando literalmente el comentario', () => {
    expect(
      addCommentContextToPrivateReply({
        comment: 'Tienen q cortarle las uñitas a los mirringos hermosos!! 😍',
        reply: '¡Exacto! Eso es justo lo que hacen nuestros rascadores.',
      agregar: true,
      })
    ).toBe(
      'Vi tu comentario: “Tienen q cortarle las uñitas a los mirringos hermosos!! 😍”\n\n¡Exacto! Eso es justo lo que hacen nuestros rascadores.'
    );
  });

  it('respeta el idioma configurado', () => {
    expect(
      addCommentContextToPrivateReply({
        comment: 'How much is it?',
        reply: 'It is $29 and shipping is free.',
        language: 'English',
      agregar: true,
      })
    ).toBe(
      'I saw your comment: “How much is it?”\n\nIt is $29 and shipping is free.'
    );
  });

  it('no duplica una referencia que ya abre el mensaje', () => {
    const reply =
      'Vi tu comentario sobre las uñas de los gatos. Sí, un rascador les ayuda.';
    expect(
      addCommentContextToPrivateReply({
        comment: 'Hay que cortarles las uñas',
        reply,
      agregar: true,
      })
    ).toBe(reply);
  });

  it('limita comentarios largos sin cortar emojis', () => {
    const output = addCommentContextToPrivateReply({
      comment: `${'a'.repeat(178)}🐱🐱🐱`,
      reply: 'Te cuento más.',
      language: 'es',
    agregar: true,
    });
    expect(output).toContain('…”\n\nTe cuento más.');
    expect(output).not.toContain('\ud83d”');
  });

  it('por defecto no agrega nada: Meta ya muestra el comentario', () => {
    expect(
      addCommentContextToPrivateReply({ comment: 'Precio?', reply: 'Sale $10.' })
    ).toBe('Sale $10.');
  });

  it('conserva la respuesta cuando no hay comentario', () => {
    expect(
      addCommentContextToPrivateReply({
        comment: null,
        reply: 'Hola, te cuento.',
      })
    ).toBe('Hola, te cuento.');
  });
});
