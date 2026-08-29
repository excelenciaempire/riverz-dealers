import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Recomendar un producto también dibuja una tarjeta.
 *
 * El agente manda dos clases de enlace: el de carrito, cuando cierra la venta,
 * y el de la FICHA, cuando recomienda algo ("el Serum Pilar sale $39.990,
 * mirálo acá"). El primero ya se dibujaba como tarjeta. El segundo salía como
 * un enlace azul, con los UTM a la vista, y sacaba a la persona del chat —
 * justo lo que la tarjeta viene a evitar, y en el mensaje donde más se decide
 * una compra.
 *
 * Se comprueba sobre el archivo, como el resto de lo del widget: el cargador
 * es JavaScript suelto que corre en la tienda y la tarjeta depende de él.
 */
describe('la tarjeta de una recomendación', () => {
  const chat = readFileSync('src/components/webchat/message-text.tsx', 'utf8');
  const tarjeta = readFileSync('src/components/webchat/product-card.tsx', 'utf8');
  const ruta = readFileSync('src/app/api/widget/product/route.ts', 'utf8');

  it('el chat reconoce la ficha en las tres plataformas', () => {
    // Shopify dice /products/, Tiendanube /productos/, Woo /producto/.
    for (const seccion of ['products', 'productos', 'product', 'producto']) {
      expect(chat).toContain(`'${seccion}'`);
    }
    expect(chat).toContain('esFichaDeProducto');
  });

  it('y la manda a la tarjeta, no a un enlace pelado', () => {
    expect(chat).toContain('fichaUrl={href}');
  });

  it('la tarjeta sabe pedir por ficha además de por variante', () => {
    expect(tarjeta).toContain('url=${encodeURIComponent(fichaUrl ?? href)}');
    expect(tarjeta).toContain('variant=${encodeURIComponent(variante)}');
  });

  it('y adopta la variante que resuelve el servidor', () => {
    // Sin esto la tarjeta tendría foto y precio pero ningún botón que compre:
    // media tarjeta, que es peor que ninguna.
    expect(tarjeta).toContain('if (!variante && d.variant) setVariante');
    expect(tarjeta).toContain('prod?.cart_url');
  });

  it('el servidor resuelve por handle y devuelve con qué comprar', () => {
    expect(ruta).toContain('handleDeLaFicha');
    expect(ruta).toContain('cart_url');
    // El enlace de compra sale de la misma función que usa el agente.
    expect(ruta).toContain('armarLinkDeCompra');
  });

  it('una portada de categoría NO es un producto', () => {
    // `/collections/serums` tiene la misma forma que una ficha si sólo se mira
    // el último tramo. Resolverla como producto mostraría una tarjeta de algo
    // que la persona no pidió.
    const bloque = ruta.slice(ruta.indexOf('function handleDeLaFicha'));
    expect(bloque).toContain('tramos[tramos.length - 2]');
  });
});
