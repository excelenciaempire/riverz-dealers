import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { construirHerramientas } from './runner';
import type { AiAgent } from './types';

/**
 * Un canal no puede saber menos que otro.
 *
 * Chat web, WhatsApp, comentarios y llamadas son el mismo agente con el mismo
 * conocimiento: lo único que cambia es el sobre. Todos se arman con
 * `construirHerramientas`, así que en principio una capacidad nueva llega
 * sola a los cuatro.
 *
 * En principio. La forma en que esto se rompe no es una excepción declarada
 * —esas están bien y se listan acá abajo— sino una excepción que alguien
 * agrega de paso: una línea más en un `Set`, un `filter` nuevo, una copia
 * local de una herramienta que se congela el día que se escribe. Nada falla;
 * el teléfono simplemente contesta peor que el chat, que es la clase de
 * diferencia que nadie ve hasta que un cliente la sufre.
 *
 * `modos-de-herramientas.test.ts` ya cubre borrador y comentario, que corren
 * en proceso. Acá se cubre la voz, que vive del otro lado de un puente HTTP y
 * de un worker en Python — los dos lugares donde la lista se puede recortar
 * sin que TypeScript diga nada.
 *
 * Como en `toolset.test.ts`, algunas pruebas leen el código fuente a
 * propósito: lo que se quiere fijar no es el comportamiento de una función
 * sino QUÉ SE LE OFRECE al modelo en cada canal, que es una lista literal.
 */

const raiz = process.cwd();
const contextoDeVoz = readFileSync(join(raiz, 'src/lib/voice/context.ts'), 'utf8');
const puenteDeVoz = readFileSync(
  join(raiz, 'src/app/api/internal/voice/tool/route.ts'),
  'utf8',
);
const workerDeVoz = readFileSync(join(raiz, 'voice-worker/tools.py'), 'utf8');

/**
 * Lo que el teléfono NO tiene, y por qué. Cada exclusión se justifica o se va.
 *
 *   escalate_to_call — pedir una llamada estando en una llamada.
 *
 * `web_search` no está acá: es la herramienta de servidor de Anthropic, que no
 * se puede reenviar por el puente. La capacidad sí llega, con otro nombre
 * (`buscar_en_internet`) y ejecutada del lado del servidor.
 */
const EXCLUIDAS_EN_LLAMADA = new Set(['escalate_to_call']);

/** La misma capacidad que `web_search`, en la forma que el puente sabe mover. */
const PUENTE_DE_BUSQUEDA = 'buscar_en_internet';

/** Sólo del teléfono: lo que no se puede dictar en voz alta se manda escrito. */
const SOLO_DEL_TELEFONO = ['send_whatsapp', PUENTE_DE_BUSQUEDA];

const agente = {
  id: 'a1',
  workspace_id: 'w1',
  name: 'Test',
  model: 'claude-opus-5',
  product_scope: 'all',
  // Todo prendido: acá se prueba la paridad entre canales, no la pizarra.
  tools: {
    buscar_producto: 'auto',
    ver_producto: 'auto',
    lookup_order: 'auto',
    crear_pedido: 'auto',
    crear_checkout: 'auto',
    editar_pedido: 'auto',
    registrar_pago: 'auto',
    cancelar_pedido: 'auto',
    reembolsar: 'auto',
    abrir_devolucion: 'auto',
    etiquetar_contacto: 'auto',
    cerrar_conversacion: 'auto',
    ver_contacto: 'auto',
    no_se_la_respuesta: 'auto',
    buscar_en_internet: 'auto',
  },
} as unknown as AiAgent;

const shopify = { config: null, canCreateOrders: true } as never;

/** Lo que ve el agente por chat, que es la vara. */
const delChat = construirHerramientas({
  agent: agente,
  hayContacto: true,
  shopify,
  otherStore: null,
  voiceCtx: null,
  topeDescuento: 0,
}).map((t) => t as unknown as { name: string; input_schema?: unknown });

describe('paridad entre canales', () => {
  it('todo lo del chat llega al teléfono, salvo lo excluido a propósito', () => {
    // El puente sólo sabe mover herramientas con esquema propio; las de
    // servidor viajan por su propia vía (ver la prueba de abajo).
    const esperadas = delChat
      .filter((t) => t.input_schema !== undefined)
      .map((t) => t.name)
      .filter((n) => !EXCLUIDAS_EN_LLAMADA.has(n));

    expect(esperadas.length).toBeGreaterThan(10);
    // La lista de partida es la del chat, no una propia del teléfono.
    expect(contextoDeVoz).toContain('construirHerramientas(');

    // Y no hay más recortes por nombre que los dos conocidos: el Set de
    // exclusiones y el upsell, que necesita un pedido en contexto. Un
    // `.filter` nuevo acá es exactamente la forma en que el teléfono se queda
    // atrás sin que nada falle.
    const recortes = contextoDeVoz.match(/t\.name !== '([^']+)'/g) ?? [];
    expect(recortes).toEqual(["t.name !== 'update_order'"]);
  });

  it('la lista de exclusiones de la llamada es exactamente la declarada', () => {
    // Ésta es la línea que hay que mirar cuando el teléfono "sabe menos".
    const m = contextoDeVoz.match(/const NO_EN_LLAMADA = new Set\(\[([^\]]*)\]\)/);
    expect(m, 'no se encontró NO_EN_LLAMADA en context.ts').toBeTruthy();
    const declaradas = (m![1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1));
    expect(new Set(declaradas)).toEqual(EXCLUIDAS_EN_LLAMADA);
  });

  it('la búsqueda en internet también llega al teléfono', () => {
    // Por chat la resuelve Anthropic dentro del turno; por teléfono el modelo
    // es otro, así que la corre el servidor y vuelve como texto. Es la misma
    // capacidad: si está en el chat, tiene que estar en la llamada.
    expect(delChat.map((t) => t.name)).toContain('web_search');
    expect(contextoDeVoz).toContain('BUSCAR_EN_INTERNET_TOOL');
    expect(puenteDeVoz).toContain(`body.tool === '${PUENTE_DE_BUSQUEDA}'`);
  });

  it('todo lo que sólo existe en el teléfono lo atiende el puente', () => {
    // Una herramienta ofrecida al worker y no atendida acá cae en `runTool`,
    // que no la conoce: el modelo promete algo y recibe un error a mitad de
    // la llamada.
    for (const nombre of SOLO_DEL_TELEFONO) {
      expect(contextoDeVoz).toContain(nombre);
      expect(puenteDeVoz).toContain(`body.tool === '${nombre}'`);
    }
  });

  it('el worker no se saltea el esquema del backend para ninguna tool', () => {
    // El worker tenía cinco herramientas escritas a mano que se salteaban el
    // esquema: la copia local no conocía el enum de ofertas del comercio ni el
    // descuento por transferencia. Siguen existiendo como red —se arman sólo
    // si el esquema falla— pero ya no tienen prioridad.
    expect(workerDeVoz).not.toContain('if not nombre or nombre in _A_MANO:');
    // Y la red sigue puesta: `enabled` se recorta con lo que sí se armó, así
    // que el bloque a mano cubre exactamente el hueco.
    expect(workerDeVoz).toContain('enabled -= hechas');
  });
});
