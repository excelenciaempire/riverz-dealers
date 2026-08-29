import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { esEnlaceDePago } from './boton-de-pago';

/**
 * El último clic de la venta.
 *
 * Cuando el agente cierra, manda la dirección de la caja. Como texto es una
 * tira de sesenta caracteres con parámetros a la vista, y le pide a la persona
 * que confíe en algo que no puede leer — justo en el clic que decide la compra.
 *
 * Lo que se fija acá es QUÉ cuenta como caja: de más, y una ficha de producto
 * se dibuja como "ir a pagar" sin que nadie haya elegido nada; de menos, y el
 * enlace vuelve a ser una tira de texto.
 */

const TIENDA = 'https://pilarargentina.store';

describe('qué es un enlace de pago', () => {
  it('la caja de cada plataforma', () => {
    // Shopify y Woo: /checkout. Tiendanube: /comprar/.
    expect(esEnlaceDePago(`${TIENDA}/checkout`, [TIENDA])).toBe(true);
    expect(esEnlaceDePago(`${TIENDA}/checkout/?add-to-cart=42&quantity=1`, [TIENDA])).toBe(true);
    expect(esEnlaceDePago(`${TIENDA}/comprar/`, [TIENDA])).toBe(true);
  });

  it('un cobro de Mercado Pago, que es de otro dominio', () => {
    // Es la caja de los comercios sin caja propia, así que no se puede
    // comparar contra el dominio de la tienda.
    expect(esEnlaceDePago('https://mpago.la/2abcdef', [TIENDA])).toBe(true);
    expect(
      esEnlaceDePago('https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1', [TIENDA]),
    ).toBe(true);
  });

  it('una ficha o un carrito NO son la caja', () => {
    // Esos ya se dibujan como tarjeta, con foto y precio. Tratarlos como caja
    // saltearía el paso donde la persona elige.
    expect(esEnlaceDePago(`${TIENDA}/products/serum-pilar`, [TIENDA])).toBe(false);
    expect(esEnlaceDePago(`${TIENDA}/cart/42:1`, [TIENDA])).toBe(false);
  });

  it('la caja de OTRA tienda no cuenta', () => {
    // El agente lee mensajes de desconocidos: un enlace pegado por el visitante
    // no puede pintarse como el botón de pago del comercio.
    expect(esEnlaceDePago('https://otra-tienda.com/checkout', [TIENDA])).toBe(false);
    expect(esEnlaceDePago('cualquier cosa', [TIENDA])).toBe(false);
  });
});

describe('a qué tienda se manda a comprar', () => {
  const ruta = readFileSync('src/app/api/widget/product/route.ts', 'utf8');

  it('a la tienda donde la persona ya está', () => {
    // El mismo serum puede estar en Shopify y en Tiendanube, con precios
    // distintos. Mandarla a la otra es mandarla a un carrito vacío, con otro
    // precio y otra caja.
    expect(ruta).toContain('function elegirPublicacion');
    const bloque = ruta.slice(ruta.indexOf('function elegirPublicacion'));
    expect(bloque.slice(0, 900)).toContain('host(String(f.url ?? \'\')) === aqui');
  });

  it('y si ahí no está, a la principal', () => {
    const bloque = ruta.slice(ruta.indexOf('function elegirPublicacion'));
    expect(bloque.slice(0, 900)).toContain('!f.master_id');
  });

  it('la tarjeta le dice al servidor dónde está parada', () => {
    const tarjeta = readFileSync('src/components/webchat/product-card.tsx', 'utf8');
    expect(tarjeta).toContain('origin=${encodeURIComponent(storeOrigin)}');
  });
});
