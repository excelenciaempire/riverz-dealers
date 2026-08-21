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
function db(opts: {
  config?: Fila;
  previo?: Fila;
  tienda?: Fila;
  /** Error que devuelve el insert. `23505` = ya hay uno para este contacto. */
  errorInsert?: { code?: string; message: string } | null;
  /** Lo que aparece al releer después de ese choque. */
  gemelo?: Fila;
}) {
  const insertados: Record<string, unknown>[] = [];
  let leidosDescuento = 0;
  const cliente = {
    from(tabla: string) {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => {
        if (tabla === 'workspace_checkout_config') return { data: opts.config ?? null };
        if (tabla === 'agent_discounts') {
          leidosDescuento += 1;
          // La primera lectura es "¿ya tiene uno?"; la segunda, la de después
          // del choque contra el índice único.
          return { data: leidosDescuento === 1 ? (opts.previo ?? null) : (opts.gemelo ?? null) };
        }
        return { data: opts.tienda ?? null };
      };
      q.insert = async (fila: Record<string, unknown>) => {
        insertados.push(fila);
        return { data: null, error: opts.errorInsert ?? null };
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

describe('el codigo no se adivina', () => {
  const args = { workspaceId: 'w', contactId: 'c-1', pedido: 10 };

  const conRegla = () =>
    restMock
      .mockResolvedValueOnce({ price_rules: [] })
      .mockResolvedValueOnce({ price_rule: { id: 77 } })
      .mockResolvedValueOnce({});

  it('un visitante sin nombre no recibe HOLA10', async () => {
    // El primer candidato era `nombre + porcentaje`, y quien entra por el chat
    // web no tiene nombre: el primer cupón de una tienda salía literalmente
    // `HOLA10`. La regla vale para cualquier cliente y se gasta con un uso, así
    // que adivinarlo no era leer el descuento ajeno: era quemárselo a la
    // persona a la que se lo acabábamos de prometer.
    conRegla();
    const r = await emitirCupon(
      db({ config: { max_discount_percent: 10 }, tienda }).cliente,
      { ...args, contactName: null },
    );
    expect('code' in r).toBe(true);
    if ('code' in r) {
      expect(r.code).not.toBe('HOLA10');
      expect(r.code.length).toBeGreaterThan('HOLA10'.length);
    }
  });

  it('dos personas con el mismo nombre no reciben el mismo código', async () => {
    conRegla();
    const a = await emitirCupon(
      db({ config: { max_discount_percent: 10 }, tienda }).cliente,
      { ...args, contactName: 'Ana' },
    );
    restMock.mockReset();
    conRegla();
    const b = await emitirCupon(
      db({ config: { max_discount_percent: 10 }, tienda }).cliente,
      { ...args, contactId: 'c-2', contactName: 'Ana' },
    );
    expect('code' in a && 'code' in b && a.code !== b.code).toBe(true);
  });

  it('un porcentaje ilegible cae al MÍNIMO, no al tope', async () => {
    // `percent: "quince"` llegaba como NaN y el respaldo era el tope entero: un
    // argumento mal formado regalaba el descuento más grande autorizado.
    conRegla();
    const r = await emitirCupon(db({ config: { max_discount_percent: 30 }, tienda }).cliente, {
      ...args,
      pedido: Number('quince'),
    });
    expect(r).toMatchObject({ percent: 1 });
  });
});

describe('carrera por el mismo contacto', () => {
  const args = { workspaceId: 'w', contactId: 'c-1', contactName: 'Ana', pedido: 10 };

  it('si otra llamada ya emitió uno, entrega ESE y no un error', async () => {
    // El bucle de herramientas puede pedir dos `tool_use` en el mismo turno.
    // Antes quedaba lo peor de los dos mundos: el cupón vivo en la tienda y el
    // modelo diciendole a la clienta que no se pudo generar.
    restMock
      .mockResolvedValueOnce({ price_rules: [] })
      .mockResolvedValueOnce({ price_rule: { id: 77 } })
      .mockResolvedValueOnce({});
    const r = await emitirCupon(
      db({
        config: { max_discount_percent: 10 },
        tienda,
        errorInsert: { code: '23505', message: 'duplicate key' },
        gemelo: { code: 'ANA10XYZAB', percent: 10 },
      }).cliente,
      args,
    );
    expect(r).toEqual({ code: 'ANA10XYZAB', percent: 10 });
  });

  it('cualquier otro fallo al registrar NO entrega el cupón', async () => {
    restMock
      .mockResolvedValueOnce({ price_rules: [] })
      .mockResolvedValueOnce({ price_rule: { id: 77 } })
      .mockResolvedValueOnce({});
    const r = await emitirCupon(
      db({
        config: { max_discount_percent: 10 },
        tienda,
        errorInsert: { code: '42501', message: 'permission denied' },
      }).cliente,
      args,
    );
    expect(r).toMatchObject({ error: 'shopify_rechazo' });
  });
});

describe('reglas de precio paginadas', () => {
  const args = { workspaceId: 'w', contactId: 'c-1', contactName: 'Ana', pedido: 10 };

  it('encuentra la regla aunque esté en la segunda página', async () => {
    // Con una app de combos instalada se pasan de 250 reglas sin esfuerzo: la
    // nuestra quedaba fuera de la primera página y se creaba una `Riverz 10%`
    // nueva en cada emisión, hasta llenar el panel de reglas idénticas.
    const primeraPagina = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      title: `Otra ${i}`,
    }));
    restMock
      .mockResolvedValueOnce({ price_rules: primeraPagina })
      .mockResolvedValueOnce({ price_rules: [{ id: 999, title: 'Riverz 10%' }] })
      .mockResolvedValueOnce({});
    const r = await emitirCupon(db({ config: { max_discount_percent: 10 }, tienda }).cliente, args);
    expect(r).toMatchObject({ percent: 10 });
    // Dos listados y la creación del código. Ninguna crea una regla nueva.
    expect(restMock).toHaveBeenCalledTimes(3);
    expect(restMock.mock.calls[1][0]).toContain('since_id=250');
  });
});
