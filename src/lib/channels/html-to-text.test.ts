import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, htmlToText } from './html-to-text';

describe('decodeHtmlEntities', () => {
  it('devuelve las letras acentuadas y la puntuación del español', () => {
    expect(
      decodeHtmlEntities(
        '&iexcl;Recibi&oacute; el pedido! &Ntilde;and&uacute; &iquest;s&iacute;?',
      ),
    ).toBe('¡Recibió el pedido! Ñandú ¿sí?');
  });

  it('decodifica las referencias numéricas', () => {
    expect(decodeHtmlEntities('&#39;hola&#x27; &#8230;')).toBe("'hola' …");
  });

  it('decodifica una sola vez', () => {
    expect(decodeHtmlEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('deja como está lo que no es un carácter', () => {
    const raw = '&constructor; &#0; &#xD800; AT&T';
    expect(decodeHtmlEntities(raw)).toBe(raw);
  });
});

describe('htmlToText', () => {
  it('saca las etiquetas y después decodifica las entidades', () => {
    expect(
      htmlToText('<p>Env&iacute;o&nbsp;gratis &lt;hoy&gt;</p><p>Chau</p>'),
    ).toBe('Envío gratis <hoy>\n\nChau');
  });
});
