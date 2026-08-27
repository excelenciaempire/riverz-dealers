import { describe, expect, it } from 'vitest';
import {
  marcaDelLanding,
  marcarEnlace,
  marcarEnlaces,
  marcarParaCanal,
} from './enlaces';

describe('marcarParaCanal', () => {
  it('marca los canales que venden por link', () => {
    expect(marcarParaCanal('vení a https://tienda.com/p', 'whatsapp')).toContain(
      'riverz=whatsapp',
    );
    expect(marcarParaCanal('https://tienda.com/p', 'webchat')).toContain(
      'riverz=webchat',
    );
    expect(marcarParaCanal('https://tienda.com/p', 'gmail')).toContain('riverz=email');
  });

  it('no toca un comentario público ni una llamada', () => {
    const t = 'mirá https://tienda.com/p';
    expect(marcarParaCanal(t, 'ig_comment')).toBe(t);
    expect(marcarParaCanal(t, 'voice')).toBe(t);
  });

  it('marcar dos veces da lo mismo — es lo que sostiene el doble marcado', () => {
    // Se marca donde se compone el texto Y en el adaptador. Si no fuera
    // idempotente, el cliente recibiría el link con los parámetros repetidos.
    const una = marcarParaCanal('https://tienda.com/p', 'whatsapp');
    expect(marcarParaCanal(una, 'whatsapp')).toBe(una);
  });
});

describe('marcarEnlace', () => {
  it('marca un link de la tienda', () => {
    const url = marcarEnlace('https://tienda.com/products/remera', {
      medio: 'whatsapp',
      campana: 'abc',
    });
    const p = new URL(url).searchParams;
    expect(p.get('riverz')).toBe('whatsapp.abc');
    expect(p.get('utm_source')).toBe('riverz');
    expect(p.get('utm_campaign')).toBe('abc');
  });

  it('conserva lo que ya traía el link', () => {
    const url = marcarEnlace('https://tienda.com/p?variant=42#detalle', {
      medio: 'whatsapp',
    });
    expect(url).toContain('variant=42');
    expect(url).toContain('#detalle');
  });

  it('no pisa el utm del comercio, pero igual deja su marca', () => {
    const url = marcarEnlace('https://tienda.com/p?utm_source=newsletter', {
      medio: 'whatsapp',
    });
    const p = new URL(url).searchParams;
    expect(p.get('utm_source')).toBe('newsletter');
    expect(p.get('riverz')).toBe('whatsapp');
  });

  it('es idempotente', () => {
    const una = marcarEnlace('https://tienda.com/p', { medio: 'whatsapp' });
    expect(marcarEnlace(una, { medio: 'instagram' })).toBe(una);
  });

  it('no toca links propios ni protocolos raros', () => {
    expect(marcarEnlace('https://riverz.co/panel', { medio: 'whatsapp' })).toBe(
      'https://riverz.co/panel',
    );
    expect(marcarEnlace('tel:+5491100000000', { medio: 'whatsapp' })).toBe(
      'tel:+5491100000000',
    );
    expect(marcarEnlace('no soy una url', { medio: 'whatsapp' })).toBe('no soy una url');
  });
});

describe('marcarEnlaces', () => {
  it('marca los links de un mensaje y deja el resto igual', () => {
    const texto = 'Mirá esto: https://tienda.com/a y esto https://tienda.com/b ¡dale!';
    const out = marcarEnlaces(texto, { medio: 'whatsapp' });
    expect(out.startsWith('Mirá esto: ')).toBe(true);
    expect(out).toContain('¡dale!');
    expect((out.match(/riverz=whatsapp/g) ?? []).length).toBe(2);
  });

  it('no se come la puntuación final', () => {
    const out = marcarEnlaces('Comprá en https://tienda.com/a.', { medio: 'whatsapp' });
    expect(out.endsWith('.')).toBe(true);
    expect(out).toContain('riverz=whatsapp');
    // El punto no puede haber quedado adentro del link.
    expect(out).not.toContain('a.?');
  });

  it('deja intacto un texto sin links', () => {
    expect(marcarEnlaces('hola, ¿cómo va?', { medio: 'whatsapp' })).toBe(
      'hola, ¿cómo va?',
    );
  });
});

describe('marcaDelLanding', () => {
  it('reconoce nuestra marca en el landing relativo de Shopify', () => {
    expect(marcaDelLanding('/products/remera?riverz=whatsapp.abc')).toEqual({
      medio: 'whatsapp',
      campana: 'abc',
    });
    expect(marcaDelLanding('/products/remera?riverz=plantilla')).toEqual({
      medio: 'plantilla',
      campana: null,
    });
  });

  it('acepta el respaldo por utm', () => {
    expect(
      marcaDelLanding('/p?utm_source=riverz&utm_medium=whatsapp&utm_campaign=x'),
    ).toEqual({ medio: 'whatsapp', campana: 'x' });
  });

  it('no reclama lo que no es nuestro', () => {
    expect(marcaDelLanding('/p?utm_source=facebook&fbclid=xyz')).toBeNull();
    expect(marcaDelLanding('/p')).toBeNull();
    expect(marcaDelLanding(null)).toBeNull();
  });
});
