import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolSwitchboard, type Disponibilidad } from './tool-switchboard';

/**
 * El tope de descuento: el número que se leía en tres lugares y no se podía
 * escribir en ninguno.
 *
 * Se leía en la pizarra (para decidir si ofrecer la herramienta), en el runner
 * (para armar su descripción) y al emitir el cupón (para recortar lo que el
 * modelo proponga) — y no había pantalla ni endpoint que lo guardara. Nacía en
 * 0, y con 0 la herramienta ni se le ofrece al agente: "Ofrecer un descuento"
 * era un interruptor que no se podía encender nunca.
 */

const SIN_NADA: Disponibilidad = {
  tienda: false,
  shopify: false,
  cobro: false,
  descuento: false,
  voz: false,
};

const pintar = (props: Partial<Parameters<typeof ToolSwitchboard>[0]> = {}) =>
  renderToStaticMarkup(
    <ToolSwitchboard
      agent={{}}
      tools={null}
      onChange={() => {}}
      disponible={SIN_NADA}
      {...props}
    />,
  );

describe('el tope de descuento en la pizarra', () => {
  it('sin `onTope` no aparece ningún campo: la pantalla vieja sigue igual', () => {
    expect(pintar()).not.toContain('type="number"');
  });

  it('con `onTope` aparece el campo, con el valor de la cuenta', () => {
    const html = pintar({ tope: 15, onTope: () => {} });
    expect(html).toContain('type="number"');
    expect(html).toContain('value="15"');
    expect(html).toContain('Hasta');
  });

  it('está acotado: nadie regala más de la mitad desde la pantalla', () => {
    const html = pintar({ tope: 15, onTope: () => {} });
    expect(html).toContain('max="50"');
    expect(html).toContain('min="0"');
  });

  it('con la herramienta apagada el campo no se muestra', () => {
    const html = pintar({
      tope: 15,
      onTope: () => {},
      tools: { ofrecer_descuento: 'off' },
    });
    expect(html).not.toContain('type="number"');
  });

  it('dice que falta Shopify, que es quien emite el cupón', () => {
    // Sin Shopify la herramienta no se ejecuta: el cupón lo emite Shopify. Antes
    // se ofrecía igual en una tienda Tiendanube y fallaba DESPUÉS de que el
    // agente le prometiera la rebaja a la clienta.
    const html = pintar({ tope: 15, onTope: () => {} });
    expect(html.toLowerCase()).toContain('shopify');
  });

  it('con Shopify conectado ya no reclama nada', () => {
    const html = pintar({
      tope: 15,
      onTope: () => {},
      disponible: { ...SIN_NADA, shopify: true, tienda: true, descuento: true },
    });
    expect(html).toContain('type="number"');
    expect(html.toLowerCase()).not.toContain('conecta shopify');
  });
});
