import { describe, it, expect, vi } from 'vitest';

const unir = vi.fn(async () => 'c1');
vi.mock('@/lib/contacts/dedupe', () => ({ linkUnifiedContact: unir }));

const { identificarPorElPedido } = await import('./identidad');

/**
 * Lo que se fija acá es CUÁNDO se une, no cómo.
 *
 * Unir de más es una fuga —le mostrás a una persona los pedidos de otra— y
 * unir de menos parte al mismo cliente en dos fichas. La vara es qué respalda
 * el dato: un pedido con dirección sí, un correo tipeado en un chat no (eso
 * lo decide `/api/widget/identify`, que a propósito no une).
 */

/** Una base de mentira con un solo contacto. */
function baseCon(contacto: Record<string, unknown> | null) {
  const actualizado: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: contacto }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        actualizado.push(patch);
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({ data: { ...contacto, ...patch } }),
            }),
          }),
        };
      },
    }),
  };
  return { db: db as never, actualizado };
}

describe('identificarPorElPedido', () => {
  it('completa lo que falta y une', async () => {
    unir.mockClear();
    const { db, actualizado } = baseCon({ id: 'c1', name: null, phone: null, email: null });
    await identificarPorElPedido(db, {
      contactId: 'c1',
      name: 'Ana',
      phone: '+5491133334444',
      email: 'ANA@Mail.com',
    });
    expect(actualizado[0]).toEqual({
      name: 'Ana',
      phone: '+5491133334444',
      email: 'ana@mail.com',
      // El origen es lo que despues habilita unir esta ficha con la de otro
      // canal: un pedido tiene del otro lado una direccion a la que va a
      // llegar algo. Ver contacts/identidad-probada.ts.
      phone_origen: 'pedido',
      email_origen: 'pedido',
    });
    expect(unir).toHaveBeenCalledOnce();
  });

  it('NO pisa lo que el comercio ya tenía cargado', async () => {
    const { db, actualizado } = baseCon({
      id: 'c1',
      name: 'Ana Pérez',
      phone: '+5491199998888',
      email: 'ana@empresa.com',
    });
    await identificarPorElPedido(db, {
      contactId: 'c1',
      name: 'ana',
      phone: '+5491133334444',
      email: 'otra@mail.com',
    });
    expect(actualizado).toHaveLength(0);
  });

  it('un teléfono demasiado corto no entra: uniría gente que no se conoce', async () => {
    const { db, actualizado } = baseCon({ id: 'c1', name: null, phone: null, email: null });
    await identificarPorElPedido(db, { contactId: 'c1', phone: '1234' });
    expect(actualizado).toHaveLength(0);
  });

  it('sin contacto no hace nada', async () => {
    unir.mockClear();
    const { db } = baseCon({ id: 'c1' });
    await identificarPorElPedido(db, { contactId: null, phone: '+5491133334444' });
    expect(unir).not.toHaveBeenCalled();
  });

  it('un fallo de la base no puede tumbar un pedido ya creado', async () => {
    const db = {
      from: () => {
        throw new Error('base caída');
      },
    } as never;
    await expect(
      identificarPorElPedido(db, { contactId: 'c1', phone: '+5491133334444' }),
    ).resolves.toBeUndefined();
  });
});
