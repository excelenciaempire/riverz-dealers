import { describe, it, expect, beforeEach } from 'vitest';
import { reclamarTraspaso } from './seguir-en-whatsapp';
import type { Contact } from '@/types';

/**
 * Todos los caminos del reclamo, uno por uno.
 *
 * Es la parte del traspaso donde un error no se ve: nada falla, el mensaje
 * entra a la bandeja igual, y lo único que pasa es que el agente le hace
 * repetir todo a alguien que ya lo había contado. O peor: une dos fichas que no
 * son la misma persona, y le muestra a alguien los pedidos de otro.
 *
 * La base es un doble en memoria. Lo que se prueba es la DECISIÓN —cuándo une,
 * cuándo no, y qué queda escrito—, no PostgREST.
 */

type Fila = Record<string, unknown>;

/** Un doble de Supabase con lo justo: select/eq/is/in/update/insert. */
function baseFalsa(tablas: Record<string, Fila[]>) {
  const escrituras: { tabla: string; patch: Fila; donde: Fila }[] = [];

  function from(tabla: string) {
    const filtros: [string, unknown][] = [];
    let enFiltro: [string, unknown[]] | null = null;
    let nulos: string[] = [];
    let patch: Fila | null = null;

    const filas = () =>
      (tablas[tabla] ?? []).filter(
        (f) =>
          filtros.every(([k, v]) => f[k] === v) &&
          nulos.every((k) => f[k] == null) &&
          (!enFiltro || enFiltro[1].includes(f[enFiltro[0]])),
      );

    const api = {
      select() {
        return api;
      },
      eq(k: string, v: unknown) {
        filtros.push([k, v]);
        return api;
      },
      is(k: string, v: unknown) {
        if (v === null) nulos.push(k);
        return api;
      },
      in(k: string, v: unknown[]) {
        enFiltro = [k, v];
        return api;
      },
      update(p: Fila) {
        patch = p;
        return api;
      },
      insert(p: Fila) {
        (tablas[tabla] ??= []).push({ ...p });
        return Promise.resolve({ data: null, error: null });
      },
      async maybeSingle() {
        return { data: filas()[0] ?? null, error: null };
      },
      // `await` sobre el constructor: aplica el update si lo hay y devuelve
      // las filas afectadas, como PostgREST con `.select()`.
      then(resolve: (v: { data: Fila[] | null; error: null }) => void) {
        const afectadas = filas();
        if (patch) {
          for (const f of afectadas) Object.assign(f, patch);
          escrituras.push({
            tabla,
            patch,
            donde: Object.fromEntries(filtros),
          });
        }
        resolve({ data: afectadas, error: null });
      },
    };
    return api;
  }

  return { db: { from } as never, tablas, escrituras };
}

const AHORA = new Date().toISOString();
const ANTIER = new Date(Date.now() - 48 * 3600_000).toISOString();

const wa = (extra: Partial<Contact> = {}) =>
  ({
    id: 'wa1',
    workspace_id: 'w1',
    channel: 'whatsapp',
    phone: '+5491122334455',
    created_at: '2026-01-02T00:00:00Z',
    ...extra,
  }) as Contact;

function armar(opts: {
  handoff?: Partial<Fila>;
  visitante?: Fila;
  whatsapp?: Fila;
}) {
  return baseFalsa({
    webchat_handoffs: [
      {
        code: 'ABCDEFGHJK',
        workspace_id: 'w1',
        contact_id: 'v1',
        conversation_id: 'c1',
        created_at: AHORA,
        claimed_at: null,
        claimed_contact_id: null,
        ...opts.handoff,
      },
    ],
    contacts: [
      {
        id: 'v1',
        workspace_id: 'w1',
        channel: 'webchat',
        phone: null,
        phone_origen: null,
        unified_contact_id: null,
        created_at: '2026-01-01T00:00:00Z',
        ...opts.visitante,
      },
      {
        id: 'wa1',
        workspace_id: 'w1',
        channel: 'whatsapp',
        phone: '+5491122334455',
        unified_contact_id: null,
        created_at: '2026-01-02T00:00:00Z',
        ...opts.whatsapp,
      },
    ],
  });
}

const TEXTO = 'Hola, vengo del chat de la web. [RZ-ABCDEFGHJK]';

describe('el reclamo del traspaso', () => {
  let escenario: ReturnType<typeof armar>;
  beforeEach(() => {
    escenario = armar({});
  });

  it('une las dos fichas y deja el teléfono como identidad del canal', async () => {
    const ok = await reclamarTraspaso(escenario.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(true);

    const visitante = escenario.tablas.contacts.find((c) => c.id === 'v1')!;
    expect(visitante.phone).toBe('+5491122334455');
    expect(visitante.phone_origen).toBe('canal');
    // El primario es el más viejo: el visitante escribió en la web primero.
    expect(visitante.unified_contact_id).toBeNull();
    expect(escenario.tablas.contacts.find((c) => c.id === 'wa1')!.unified_contact_id).toBe('v1');
    expect(escenario.tablas.webchat_handoffs[0].claimed_at).toBeTruthy();
  });

  it('un mensaje sin código no toca nada', async () => {
    const ok = await reclamarTraspaso(escenario.db, {
      workspaceId: 'w1',
      texto: 'Hola, tienen talle M?',
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(false);
    expect(escenario.tablas.webchat_handoffs[0].claimed_at).toBeNull();
  });

  it('un código de otro comercio no une nada', async () => {
    // El mensaje llega al número de ESTE comercio. Un código ajeno o es un
    // error de tipeo o es alguien probando.
    const ok = await reclamarTraspaso(escenario.db, {
      workspaceId: 'OTRO',
      texto: TEXTO,
      contactoWhatsapp: wa({ workspace_id: 'OTRO' }),
    });
    expect(ok).toBe(false);
    expect(escenario.tablas.contacts.find((c) => c.id === 'wa1')!.unified_contact_id).toBeNull();
  });

  it('un código ya usado no vuelve a unir', async () => {
    const e = armar({ handoff: { claimed_at: AHORA, claimed_contact_id: 'otro' } });
    const ok = await reclamarTraspaso(e.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(false);
  });

  it('un código de hace dos días ya no vale', async () => {
    const e = armar({ handoff: { created_at: ANTIER } });
    const ok = await reclamarTraspaso(e.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(false);
    expect(e.tablas.webchat_handoffs[0].claimed_at).toBeNull();
  });

  it('una separación hecha a mano gana sobre la prueba', async () => {
    // Alguien del comercio miró esas dos fichas y dijo que no son la misma
    // persona. Ninguna prueba automática le gana a eso.
    const e = armar({ visitante: { union_bloqueada: true } });
    const ok = await reclamarTraspaso(e.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(false);
    expect(e.tablas.contacts.find((c) => c.id === 'wa1')!.unified_contact_id).toBeNull();
  });

  it('pisa el teléfono que el visitante había tipeado', async () => {
    // Lo escribió a mano y se equivocó, o puso el de la casa. El número desde
    // el que efectivamente escribió vale más.
    const e = armar({ visitante: { phone: '1122', phone_origen: 'afirmado' } });
    const ok = await reclamarTraspaso(e.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(true);
    expect(e.tablas.contacts.find((c) => c.id === 'v1')!.phone).toBe('+5491122334455');
  });

  it('NO pisa un teléfono que ya venía de un pedido, y no une', async () => {
    // Ese teléfono sostiene otras uniones. Si no coincide, son dos personas
    // distintas: ante la duda, no se une. Y el código NO se quema.
    const e = armar({ visitante: { phone: '+5491199887766', phone_origen: 'pedido' } });
    const ok = await reclamarTraspaso(e.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(false);
    expect(e.tablas.contacts.find((c) => c.id === 'v1')!.phone).toBe('+5491199887766');
    expect(e.tablas.webchat_handoffs[0].claimed_at).toBeNull();
  });

  it('un teléfono respaldado que es el mismo número escrito distinto sí une', async () => {
    // "+54 9 11 2233-4455" y "541122334455" son el mismo celular. Rechazarlo
    // sería negar la unión justo cuando el dato es bueno.
    const e = armar({ visitante: { phone: '541122334455', phone_origen: 'tienda' } });
    const ok = await reclamarTraspaso(e.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(true);
  });

  it('sin teléfono del lado de WhatsApp no se quema el código', async () => {
    const ok = await reclamarTraspaso(escenario.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa({ phone: undefined }),
    });
    expect(ok).toBe(false);
    // Lo importante: el código sigue sirviendo. Quemarlo dejaba a la persona
    // sin forma de reintentar salvo volver a la web.
    expect(escenario.tablas.webchat_handoffs[0].claimed_at).toBeNull();
  });

  it('respeta el árbol que ya existía: se une a la raíz, no a la hoja', async () => {
    // El contacto de WhatsApp ya colgaba de un primario más viejo. Unir la hoja
    // dejaría dos árboles apuntando cruzado y el historial partido.
    const e = armar({});
    e.tablas.contacts.push({
      id: 'raiz',
      workspace_id: 'w1',
      channel: 'whatsapp',
      unified_contact_id: null,
      created_at: '2025-06-01T00:00:00Z',
    });
    e.tablas.contacts.find((c) => c.id === 'wa1')!.unified_contact_id = 'raiz';

    const ok = await reclamarTraspaso(e.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa({ unified_contact_id: 'raiz' } as Partial<Contact>),
    });
    expect(ok).toBe(true);
    // `raiz` es de 2025: es el más viejo y queda de primario.
    expect(e.tablas.contacts.find((c) => c.id === 'raiz')!.unified_contact_id).toBeNull();
    expect(e.tablas.contacts.find((c) => c.id === 'v1')!.unified_contact_id).toBe('raiz');
  });

  it('si ya eran la misma persona, no hace nada raro', async () => {
    const e = armar({ visitante: { unified_contact_id: 'wa1' } });
    const ok = await reclamarTraspaso(e.db, {
      workspaceId: 'w1',
      texto: TEXTO,
      contactoWhatsapp: wa(),
    });
    expect(ok).toBe(true);
    expect(e.tablas.contacts.find((c) => c.id === 'v1')!.unified_contact_id).toBe('wa1');
  });
});
