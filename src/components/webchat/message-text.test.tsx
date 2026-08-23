import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageText } from './message-text';

/**
 * El texto de una burbuja lo escribe un modelo de lenguaje —o el visitante— y
 * termina dentro del DOM de un chat público. Dos cosas que no pueden fallar:
 * que el formato se lea (el precio en negrita se veía `**$69.000**`) y que
 * nada de lo que llegue se convierta en HTML ejecutable.
 */
/** El marco del chat. La tarjeta de producto lo necesita para sus botones: era
 *  lo último que quedaba cableado en español dentro del widget. */
const T = {
  adjuntar: 'Adjuntar',
  escribi: 'Escribe tu mensaje',
  enviar: 'Enviar',
  cerrar: 'Cerrar',
  caduco: 'La conversación caducó.',
  reanudar: 'Reanudar',
  reanudando: 'Reanudando…',
  sirvio: '¿Te sirvió?',
  gracias: 'Gracias por avisar.',
  graciasNo: 'Gracias, se lo paso al equipo.',
  empezar: 'Empezar',
  correo: 'tu@correo.com',
  agregar: 'Agregar',
  agregado: 'Agregado',
  agregando: 'Agregando…',
  pagar: 'Ir a pagar',
  yMas: (n: number) => `y ${n} más`,
};

const render = (text: string, storeOrigin: string | null = null) =>
  renderToStaticMarkup(
    <MessageText text={text} storeOrigin={storeOrigin} color="#A3E635" ink="#111827" T={T} />,
  );

describe('formato', () => {
  it('pone en negrita lo que el modelo marca con **', () => {
    const html = render('El **Serum Vitamina C** cuesta **$69.000**.');
    expect(html).toContain('<strong>Serum Vitamina C</strong>');
    expect(html).toContain('<strong>$69.000</strong>');
    expect(html).not.toContain('**');
  });

  it('acepta __ como negrita', () => {
    expect(render('esto es __importante__')).toContain('<strong>importante</strong>');
  });

  it('pone en itálica lo marcado con un solo *', () => {
    expect(render('es *ideal* para ti')).toContain('<em>ideal</em>');
  });

  it('no se come un asterisco suelto', () => {
    const html = render('2 * 3 = 6');
    expect(html).not.toContain('<em>');
    expect(html).toContain('2 * 3 = 6');
  });

  it('marca las viñetas', () => {
    const html = render('Incluye:\n- Vitamina C\n- Ácido hialurónico');
    expect(html).toContain('•');
    expect(html).toContain('Vitamina C');
    expect(html).not.toContain('- Vitamina C');
  });

  it('conserva la numeración de una lista', () => {
    const html = render('1. Limpia\n2. Aplica');
    expect(html).toContain('1.');
    expect(html).toContain('2.');
  });
});

describe('seguridad', () => {
  it('escapa el HTML que venga en el texto', () => {
    const html = render('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapa una etiqueta con manejador de eventos', () => {
    const html = render('<img src=x onerror=alert(1)>');
    // Lo que importa no es que la palabra "onerror" desaparezca —queda como
    // texto que el cliente lee— sino que no llegue a haber una etiqueta: con
    // `<` y `>` escapados el navegador nunca crea el elemento.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('no ejecuta HTML escondido dentro de una negrita', () => {
    const html = render('**<b onclick="x">hola</b>**');
    expect(html).not.toContain('onclick="x"');
  });
});

describe('enlaces', () => {
  it('convierte una URL en un enlace que abre fuera', () => {
    const html = render('Mirá https://tienda.com/producto acá');
    expect(html).toContain('href="https://tienda.com/producto"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('el enlace de carrito de LA tienda se vuelve una tarjeta de compra', () => {
    const html = render(
      'Listo: https://tienda.com/cart/123:1?attributes[riverz_origin]=ai',
      'https://tienda.com',
    );
    // Dos caminos, que son dos intenciones distintas: seguir conversando o
    // terminar de comprar.
    expect(html).toContain('Agregar');
    expect(html).toContain('Ir a pagar');
    // Y ya no queda la URL cruda a la vista.
    expect(html).not.toContain('href="https://tienda.com/cart/123:1');
  });

  it('un carrito de OTRO dominio sigue siendo un enlace, no una tarjeta', () => {
    const html = render('https://otra.com/cart/123:1', 'https://tienda.com');
    expect(html).not.toContain('Ir a pagar');
    expect(html).toContain('href="https://otra.com/cart/123:1"');
  });

  it('sin saber el dominio de la tienda, no inventa tarjetas', () => {
    const html = render('https://tienda.com/cart/123:1', null);
    expect(html).not.toContain('Ir a pagar');
  });

  it('un enlace de carrito con variante no numerica no arma tarjeta', () => {
    // La variante alimenta la consulta que resuelve el producto: si no es un
    // id, no hay nada que resolver y es mejor el enlace de siempre.
    const html = render('https://tienda.com/cart/abc:1', 'https://tienda.com');
    expect(html).not.toContain('Ir a pagar');
  });
});
