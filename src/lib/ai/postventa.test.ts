import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` se iza al tope del archivo, así que la fábrica no puede cerrar
// sobre una variable de acá: se declara adentro y se recupera después.
vi.mock('@/lib/approvals/ask', () => ({
  askForApproval: vi.fn(async () => ({ ok: true, approvalId: 'ap-1', notified: true })),
  // El literal real de la columna. Va acá y no inventado: el dedupe buscaba
  // 'pending' contra una columna que guarda 'pendiente' y no encontraba nunca.
  APROBACION_PENDIENTE: 'pendiente',
}));

import { askForApproval } from '@/lib/approvals/ask';
import { proponerCancelacion, proponerReembolso } from './postventa';

const pedirAprobacion = vi.mocked(askForApproval);

/**
 * Lo que se prueba acá es la línea que separa proponer de ejecutar.
 *
 * El agente lee mensajes de desconocidos, así que lo peor que puede conseguir
 * un mensaje bien armado es que al comercio le llegue una pregunta. Si alguna
 * de estas pruebas se cae, esa línea se movió.
 */

type Fila = Record<string, unknown>;

/**
 * @param filas   Los pedidos de la persona.
 * @param pendientes Solicitudes de aprobación ya abiertas para este pedido.
 */
function db(filas: Fila[], pendientes: Fila[] = []) {
  const updates: Array<{ tabla: string; patch: Record<string, unknown> }> = [];
  const cliente = {
    from(tabla: string) {
      const datos = tabla === 'approval_requests' ? pendientes : filas;
      // `limit` es el final de una cadena y también el paso previo a
      // `maybeSingle`: tiene que poder esperarse Y seguir encadenando.
      const resultado = {
        data: datos,
        error: null,
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: datos, error: null }).then(r),
        maybeSingle: async () => ({ data: datos[0] ?? null, error: null }),
      };
      const q: Record<string, unknown> = { limit: () => resultado };
      for (const m of ['select', 'eq', 'not', 'order', 'contains', 'is']) q[m] = () => q;
      // `update` guarda el parche y sigue encadenando con los `.eq(...)`, que
      // es la forma en la que se escribe una fila en este repo.
      q.update = (patch: Record<string, unknown>) => {
        updates.push({ tabla, patch });
        const fin: Record<string, unknown> = {
          then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
        };
        fin.eq = () => fin;
        return fin;
      };
      return q;
    },
  };
  return { cliente: cliente as never, updates };
}

const ctx = (filas: Fila[], pendientes: Fila[] = []) => ({
  db: db(filas, pendientes).cliente,
  workspaceId: 'w1',
  contactId: 'c1',
});

const pedido = (over: Fila = {}): Fila => ({
  id: 'o1',
  shopify_order_id: '55501',
  order_number: '1042',
  total_price: 69000,
  currency: 'COP',
  status: 'paid',
  shop_domain: 'tienda.myshopify.com',
  ...over,
});

beforeEach(() => pedirAprobacion.mockClear());

describe('cancelar', () => {
  it('no cancela: deja la solicitud y avisa al comercio', async () => {
    const out = JSON.parse(await proponerCancelacion(ctx([pedido()]), { reason: 'se arrepintió' }));
    expect(out.ok).toBe(true);
    expect(out.estado).toBe('pendiente_de_aprobacion');
    expect(pedirAprobacion).toHaveBeenCalledOnce();
    const arg = pedirAprobacion.mock.calls[0][0];
    expect(arg.kind).toBe('cancelar_pedido');
    expect(arg.payload?.shopify_order_id).toBe('55501');
  });

  it('le prohíbe al modelo decir que ya está cancelado', async () => {
    // Es el error caro: la clienta se va creyendo que se resolvió.
    const out = JSON.parse(await proponerCancelacion(ctx([pedido()]), {}));
    expect(out.message).toMatch(/NO le digas/);
  });

  it('con varios pedidos activos NO elige uno', async () => {
    const out = JSON.parse(
      await proponerCancelacion(ctx([pedido({ order_number: '1' }), pedido({ id: 'o2', order_number: '2' })]), {}),
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe('varios_pedidos');
    expect(pedirAprobacion).not.toHaveBeenCalled();
  });

  it('sin pedidos no molesta al comercio', async () => {
    const out = JSON.parse(await proponerCancelacion(ctx([]), {}));
    expect(out.ok).toBe(false);
    expect(pedirAprobacion).not.toHaveBeenCalled();
  });

  it('un pedido que no está en la tienda no se puede cancelar solo', async () => {
    const out = JSON.parse(
      await proponerCancelacion(ctx([pedido({ shopify_order_id: null })]), {}),
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe('pedido_no_cancelable');
    expect(pedirAprobacion).not.toHaveBeenCalled();
  });

  it('insistir no genera una segunda solicitud', async () => {
    // Dos avisos idénticos al comercio se leen como el mismo repetido: aprueba
    // los dos y el pedido se cancela una vez, pero el reembolso se paga dos.
    const out = JSON.parse(await proponerCancelacion(ctx([pedido()], [{ id: 'ap-1' }]), {}));
    expect(out.ok).toBe(true);
    expect(out.estado).toBe('pendiente_de_aprobacion');
    expect(pedirAprobacion).not.toHaveBeenCalled();
  });

  it('si no se pudo preguntar, no dice que quedó pedido', async () => {
    pedirAprobacion.mockResolvedValueOnce({ ok: false } as never);
    const out = JSON.parse(await proponerCancelacion(ctx([pedido()]), {}));
    expect(out.ok).toBe(false);
  });
});

describe('reembolsar', () => {
  it('deja la solicitud con el monto pedido', async () => {
    const out = JSON.parse(
      await proponerReembolso(ctx([pedido()]), { amount: 20000, reason: 'llegó dañado' }),
    );
    expect(out.estado).toBe('pendiente_de_aprobacion');
    const arg = pedirAprobacion.mock.calls[0][0];
    expect(arg.kind).toBe('reembolsar_pedido');
    expect(arg.payload?.amount).toBe(20000);
  });

  it('sin monto devuelve todo lo cobrado', async () => {
    await proponerReembolso(ctx([pedido()]), {});
    const arg = pedirAprobacion.mock.calls[0][0];
    expect(arg.payload?.amount).toBeNull();
  });

  it('un monto negativo no se convierte en un reembolso raro', async () => {
    await proponerReembolso(ctx([pedido()]), { amount: -5 });
    const arg = pedirAprobacion.mock.calls[0][0];
    expect(arg.payload?.amount).toBeNull();
  });

  it('le prohíbe al modelo decir que el dinero ya volvió', async () => {
    const out = JSON.parse(await proponerReembolso(ctx([pedido()]), {}));
    expect(out.message).toMatch(/NO le digas/);
  });
});

describe('cuando el aviso no sale', () => {
  it('marca el hilo para que lo mire una persona, con las columnas que existen', async () => {
    // La fila queda esperando en el panel, pero nadie se enteró — y a la
    // clienta ya se le dijo "te confirmo en breve". Sin esta marca, ese hilo
    // espera solo.
    //
    // Y las columnas importan: no hay un booleano `needs_human` en
    // `conversations`; lo que marca el hilo es tener `needs_human_at` puesto.
    // Escribir una columna inexistente falla en silencio.
    pedirAprobacion.mockResolvedValueOnce({
      ok: true,
      approvalId: 'ap-9',
      notified: false,
    } as never);
    const doble = db([pedido()]);
    const out = JSON.parse(
      await proponerCancelacion(
        { db: doble.cliente, workspaceId: 'w1', contactId: 'c1', conversationId: 'conv-1' },
        {},
      ),
    );
    expect(out.ok).toBe(true);
    const marca = doble.updates.find((u) => u.tabla === 'conversations');
    expect(marca).toBeTruthy();
    expect(Object.keys(marca!.patch).sort()).toEqual([
      'needs_human_at',
      'needs_human_reason',
      'status',
    ]);
    expect(marca!.patch.status).toBe('pending');
    // Y el motivo no es texto libre: la migración 178 lo acotó a una lista, así
    // que una frase inventada hacía fallar el UPDATE entero.
    expect(marca!.patch.needs_human_reason).toBe('approval_unnotified');
  });

  it('cuando sí sale, no molesta a nadie', async () => {
    const doble = db([pedido()]);
    await proponerCancelacion(
      { db: doble.cliente, workspaceId: 'w1', contactId: 'c1', conversationId: 'conv-1' },
      {},
    );
    expect(doble.updates.find((u) => u.tabla === 'conversations')).toBeUndefined();
  });
});
