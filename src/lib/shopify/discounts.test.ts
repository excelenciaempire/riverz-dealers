import { describe, it, expect, vi, beforeEach } from 'vitest';

const restMock = vi.fn();
vi.mock('./admin-client', () => ({
  ShopifyAdminClient: class {
    rest = restMock;
  },
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => s }));

import { emitirCupon, topeDeDescuento } from './discounts';

/**
 * El tope es lo único que separa "el agente destraba una venta" de "el agente
 * regala el margen del negocio". Y el porcentaje lo propone un modelo que lee
 * mensajes de desconocidos: "dame 50% o me voy" es el mensaje que va a recibir.
 *
 * Si alguna de estas pruebas se cae, ese freno se aflojó.
 */

type Fila = Record<string, unknown> | null;

/**
 * Doble de Supabase. `config` es la fila del tope, `previo` el cupón que la
 * persona ya tenga, `tienda` la conexión de Shopify.
 */
function db(opts: { config?: Fila; previo?: Fila; tienda?: Fila }) {
  const insertados: Record<string, unknown>[] = [];
  const cliente = {
    from(tabla: string) {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({
        data:
          tabla === 'workspace_checkout_config'
            ? (opts.config ?? null)
            : tabla === 'agent_discounts'
              ? (opts.previo ?? null)
              : (opts.tienda ?? null),
      });
      q.insert = async (fila: Record<string, unknown>) => {
        insertados.push(fila);
        return { data: null, error: null };
      };
      return q;
    },
  };
  return { cliente: cliente as never, insertados };
}

const tienda = { shop_domain: 'demo.myshopify.com', access_token: 'tok' };

beforeEach(() => restMock.mockReset());

describe('topeDeDescuento', () => {
  it('sin fila de configuración, no puede descontar', async () => {
    expect(await topeDeDescuento(db({}).cliente, 'w')).toBe(0);
  });

  it('lee el tope del comercio', async () => {
    expect(
      await topeDeDescuento(db({ config: { max_discount_percent: 15 } }).cliente, 'w'),
    ).toBe(15);
  });

  it('nunca deja pasar más de 50, aunque la fila diga otra cosa', async () => {
    expect(
      await topeDeDescuento(db({ config: { max_discount_percent: 90 } }).cliente, 'w'),
    ).toBe(50);
  });
});

describe('emitirCupon', () => {
  const args = { workspaceId: 'w', contactId: 'c-1', contactName: 'Ana', pedido: 10 };

  it('sin tope no emite nada', async () => {
    const r = await emitirCupon(db({}).cliente, args);
    expect(r).toMatchObject({ error: 'sin_tope' });
    expect(restMock).not.toHaveBeenCalled();
  });

  it('RECORTA lo que pide el modelo al tope del comercio', async () => {
    // El caso que importa: la clienta insiste, el modelo cede y pide 40.
    restMock
      .mockResolvedValueOnce({ price_rules: [] })
      .mockResolvedValueOnce({ price_rule: { id: 77 } })
      .mockResolvedValueOnce({});
    const { cliente, insertados } = db({
      config: { max_discount_percent: 10 },
      tienda,
    });
    const r = await emitirCupon(cliente, { ...args, pedido: 40 });
    expect(r).toMatchObject({ percent: 10 });
    expect(insertados[0].percent).toBe(10);
  });

  it('respeta un pedido menor al tope', async () => {
    restMock
      .mockResolvedValueOnce({ price_rules: [] })
      .mockResolvedValueOnce({ price_rule: { id: 77 } })
      .mockResolvedValueOnce({});
    const r = await emitirCupon(db({ config: { max_discount_percent: 20 }, tienda }).cliente, {
      ...args,
      pedido: 5,
    });
    expect(r).toMatchObject({ percent: 5 });
  });

  it('un pedido absurdo no se convierte en un cupón absurdo', async () => {
    restMock
      .mockResolvedValueOnce({ price_rules: [] })
      .mockResolvedValueOnce({ price_rule: { id: 77 } })
      .mockResolvedValueOnce({});
    const r = await emitirCupon(db({ config: { max_discount_percent: 10 }, tienda }).cliente, {
      ...args,
      pedido: -5,
    });
    expect(r).toMatchObject({ percent: 1 });
  });

  it('a quien ya tiene cupón le devuelve el MISMO', async () => {
    // Si no, insistir sería una forma de juntar cupones.
    const r = await emitirCupon(
      db({
        config: { max_discount_percent: 10 },
        previo: { code: 'ANA10', percent: 10 },
        tienda,
      }).cliente,
      args,
    );
    expect(r).toEqual({ code: 'ANA10', percent: 10 });
    expect(restMock).not.toHaveBeenCalled();
  });

  it('reusa la regla de precio que ya existe para ese porcentaje', async () => {
    // Una regla nueva por conversación llenaría el panel de Shopify.
    restMock
      .mockResolvedValueOnce({ price_rules: [{ id: 42, title: 'Riverz 10%' }] })
      .mockResolvedValueOnce({});
    const r = await emitirCupon(db({ config: { max_discount_percent: 10 }, tienda }).cliente, args);
    expect(r).toMatchObject({ percent: 10 });
    // Dos llamadas: listar reglas y crear el código. Ninguna crea regla.
    expect(restMock).toHaveBeenCalledTimes(2);
  });

  it('el cupón es de un solo uso', async () => {
    restMock
      .mockResolvedValueOnce({ price_rules: [] })
      .mockResolvedValueOnce({ price_rule: { id: 77 } })
      .mockResolvedValueOnce({});
    await emitirCupon(db({ config: { max_discount_percent: 10 }, tienda }).cliente, args);
    const creacion = restMock.mock.calls[1][1] as { body: { price_rule: Record<string, unknown> } };
    expect(creacion.body.price_rule.usage_limit).toBe(1);
    expect(creacion.body.price_rule.once_per_customer).toBe(true);
  });

  it('sin tienda conectada no promete un descuento', async () => {
    const r = await emitirCupon(db({ config: { max_discount_percent: 10 } }).cliente, args);
    expect(r).toMatchObject({ error: 'sin_tienda' });
  });

  it('si Shopify no da una regla de precio, no inventa un código', async () => {
    // Se prueba con una respuesta vacía en vez de una excepción: un doble que
    // rechaza deja una promesa suelta que el runner cuenta como fallo del
    // archivo, y lo que importa acá es el resultado, no cómo falló Shopify.
    restMock
      .mockResolvedValueOnce({ price_rules: [] })
      .mockResolvedValueOnce({ price_rule: {} });
    const r = await emitirCupon(db({ config: { max_discount_percent: 10 }, tienda }).cliente, args);
    expect(r).toMatchObject({ error: 'shopify_rechazo' });
  });
});
