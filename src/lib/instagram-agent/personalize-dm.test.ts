import { describe, it, expect } from 'vitest';
import {
  stripLinkPlaceholders,
  enforceOffer,
  enforceKnownStoreLinks,
} from './personalize-dm';

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

describe('enforceKnownStoreLinks', () => {
  it('conserva una URL real del catálogo', () => {
    const text = `Míralo aquí: ${LINKS.products[0].url}`;
    expect(enforceKnownStoreLinks(text, LINKS)).toBe(text);
  });

  it('reemplaza una URL inventada por la URL real', () => {
    expect(
      enforceKnownStoreLinks(
        'Míralo aquí: https://tienda-falsa.com/products/serum',
        LINKS,
      ),
    ).toBe(
      'Míralo aquí: https://tienda.myshopify.com/products/serum-pilar',
    );
  });

  it('repara una ruta incompleta con el enlace real', () => {
    expect(
      enforceKnownStoreLinks('Míralo: store/products/serum-pilar', LINKS),
    ).toBe(
      'Míralo: https://tienda.myshopify.com/products/serum-pilar',
    );
  });

  it('elimina URLs cuando no existe un enlace verificado', () => {
    expect(
      enforceKnownStoreLinks('Míralo: https://tienda-falsa.com/producto', null),
    ).toBe('Míralo');
  });

  it('no confunde un correo electrónico con una URL', () => {
    const text = 'Escríbenos a ayuda@tienda.com';
    expect(enforceKnownStoreLinks(text, LINKS)).toBe(text);
  });
});

/**
 * Caso real del piso autónomo: el modelo de respaldo inventó "tengo un código
 * de bienvenida para ti: CARG15" sobre una campaña SIN oferta. Ese código no
 * existe y el cliente lo intenta.
 */
describe('enforceOffer', () => {
  it('borra la frase del código inventado cuando no hay oferta', () => {
    const out = enforceOffer(
      'Hola Caro. Tengo un código de bienvenida para ti: CARG15. ¿Te ayudo con la compra?',
      null,
    );
    expect(out).not.toContain('CARG15');
    expect(out).toContain('Hola Caro.');
    expect(out).toContain('¿Te ayudo con la compra?');
  });

  it('reemplaza un código inventado por el real de la campaña', () => {
    const out = enforceOffer('Usá el código CARG15 al pagar.', {
      code: 'PILAR15',
      discount: '15%',
    });
    expect(out).toContain('PILAR15');
    expect(out).not.toContain('CARG15');
  });

  it('no toca un texto sin códigos', () => {
    const text = 'Hola Susy, ¿te armo el pedido?';
    expect(enforceOffer(text, null)).toBe(text);
  });
});
