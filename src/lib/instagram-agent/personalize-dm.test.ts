import { describe, it, expect } from 'vitest';
import { stripLinkPlaceholders } from './personalize-dm';

/**
 * Caso real: el DM que salió a una clienta decía "puedes comprarlo desde
 * nuestra tienda web, en el siguiente enlace [enlace de la tienda web]". El
 * marcador nunca debe llegar al cliente.
 */
const LINKS = {
  storeUrl: 'https://tienda.myshopify.com',
  products: [{ title: 'Serum Pilar', url: 'https://tienda.myshopify.com/products/serum-pilar' }],
};

describe('stripLinkPlaceholders', () => {
  it('cambia el marcador por el enlace real del producto', () => {
    const out = stripLinkPlaceholders(
      'Puedes comprarlo aquí: [enlace de la tienda web]',
      LINKS,
    );
    expect(out).toBe(
      'Puedes comprarlo aquí: https://tienda.myshopify.com/products/serum-pilar',
    );
  });

  it('usa la tienda cuando no hay producto', () => {
    const out = stripLinkPlaceholders('Mira acá (link aquí)', {
      storeUrl: 'https://tienda.myshopify.com',
      products: [],
    });
    expect(out).toContain('https://tienda.myshopify.com');
    expect(out).not.toContain('link aquí');
  });

  it('borra el marcador cuando no hay ningún enlace', () => {
    const out = stripLinkPlaceholders('Escríbeme y te paso [el link] .', null);
    expect(out).not.toMatch(/\[|\]/);
    expect(out).toBe('Escríbeme y te paso.');
  });

  it('no toca un texto sin marcadores', () => {
    const text = 'Hola Susy, ¿te armo el pedido? https://tienda.com/x';
    expect(stripLinkPlaceholders(text, LINKS)).toBe(text);
  });

  it('no confunde corchetes de otro tipo', () => {
    const text = 'Te queda [1 unidad] disponible';
    expect(stripLinkPlaceholders(text, LINKS)).toBe(text);
  });
});
