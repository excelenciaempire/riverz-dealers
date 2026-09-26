/**
 * Las pruebas de "Probar como cliente", guardadas como chats.
 *
 * Una sesión es lo que vio quien probaba —mensajes, plantillas, avisos— más lo
 * que opinó de cada respuesta. Con eso el equipo revisa después cómo contestó
 * el asistente (también cuando probó el dueño de la marca desde el link) y la
 * IA propone los cambios de reglas que harían que la próxima vez conteste como
 * el comercio quiere.
 *
 * Todo lo que llega del navegador pasa por acá antes de guardarse: es texto
 * que escribió quien probaba, y el link compartido no tiene sesión.
 */

export type ItemGuardado =
  | { k: 'biz'; texto: string; nota?: string; alerta?: string; hora?: string; botones?: Array<{ text: string; type: string }> }
  | { k: 'me'; texto: string; hora?: string }
  | { k: 'sys'; texto: string; icono?: 'espera' | 'llamada' | 'persona' };

export interface FeedbackGuardado {
  /** Posición del mensaje en `items`. null = la prueba entera. */
  item: number | null;
  voto: 'bien' | 'mal' | null;
  nota: string;
  at: string;
}

export interface PropuestaDeRegla {
  accion: 'crear' | 'editar';
  regla_id: string | null;
  /** Al crear: de qué asistente es. null = de todos. */
  agente_id: string | null;
  titulo: string;
  cuando: string;
  hacer: string;
  porque: string;
  aplicada?: boolean;
}

export interface PropuestaDePlataforma {
  problema: string;
  prompt: string;
}

export interface Propuestas {
  reglas: PropuestaDeRegla[];
  plataforma: PropuestaDePlataforma[];
  generadas_at?: string;
}

const MAX_ITEMS = 300;
const MAX_TEXTO = 4000;

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export function limpiarItems(v: unknown): ItemGuardado[] {
  if (!Array.isArray(v)) return [];
  const out: ItemGuardado[] = [];
  for (const crudo of v.slice(0, MAX_ITEMS)) {
    const i = (crudo ?? {}) as Record<string, unknown>;
    if (i.k === 'me') {
      out.push({ k: 'me', texto: texto(i.texto, MAX_TEXTO), hora: texto(i.hora, 8) });
    } else if (i.k === 'biz') {
      const botones = Array.isArray(i.botones)
        ? i.botones.slice(0, 5).map((b) => {
            const x = (b ?? {}) as Record<string, unknown>;
            return { text: texto(x.text, 60), type: texto(x.type, 20) };
          })
        : [];
      out.push({
        k: 'biz',
        texto: texto(i.texto, MAX_TEXTO),
        ...(i.nota ? { nota: texto(i.nota, 400) } : {}),
        ...(i.alerta ? { alerta: texto(i.alerta, 400) } : {}),
        hora: texto(i.hora, 8),
        ...(botones.length ? { botones } : {}),
      });
    } else if (i.k === 'sys') {
      const icono = i.icono === 'espera' || i.icono === 'llamada' || i.icono === 'persona' ? i.icono : undefined;
      out.push({ k: 'sys', texto: texto(i.texto, 600), ...(icono ? { icono } : {}) });
    }
  }
  return out;
}

export function limpiarFeedback(v: unknown, cantidadItems: number): FeedbackGuardado[] {
  if (!Array.isArray(v)) return [];
  const out: FeedbackGuardado[] = [];
  for (const crudo of v.slice(0, 200)) {
    const f = (crudo ?? {}) as Record<string, unknown>;
    const item =
      f.item === null || f.item === undefined
        ? null
        : Number.isSafeInteger(Number(f.item)) && Number(f.item) >= 0 && Number(f.item) < cantidadItems
          ? Number(f.item)
          : undefined;
    if (item === undefined) continue;
    const voto = f.voto === 'bien' || f.voto === 'mal' ? f.voto : null;
    const nota = texto(f.nota, 1000).trim();
    if (!voto && !nota) continue;
    out.push({ item, voto, nota, at: texto(f.at, 40) || new Date().toISOString() });
  }
  return out;
}

/** Para la lista: cuántas respuestas se marcaron bien, mal y con comentario. */
export function resumenDeFeedback(v: unknown): { bien: number; mal: number; notas: number } {
  const lista = Array.isArray(v) ? (v as Array<Partial<FeedbackGuardado>>) : [];
  return {
    bien: lista.filter((f) => f?.voto === 'bien').length,
    mal: lista.filter((f) => f?.voto === 'mal').length,
    notas: lista.filter((f) => typeof f?.nota === 'string' && f.nota.trim()).length,
  };
}

export function contarMensajes(items: ItemGuardado[]): number {
  return items.filter((i) => i.k === 'me' || i.k === 'biz').length;
}

/** El primer mensaje del cliente, para reconocer la prueba en la lista. */
export function primerMensaje(items: ItemGuardado[]): string | null {
  const m = items.find((i) => i.k === 'me');
  return m ? m.texto.slice(0, 140) : null;
}

/** La conversación con las marcas de quien probaba, en texto para el modelo. */
export function transcripcionConFeedback(
  items: ItemGuardado[],
  feedback: FeedbackGuardado[]
): string {
  const porItem = new Map<number, FeedbackGuardado[]>();
  for (const f of feedback) {
    if (f.item === null) continue;
    porItem.set(f.item, [...(porItem.get(f.item) ?? []), f]);
  }
  const lineas: string[] = [];
  items.forEach((it, idx) => {
    if (it.k === 'me') lineas.push(`[${idx}] CLIENTE: ${it.texto}`);
    else if (it.k === 'biz') lineas.push(`[${idx}] TIENDA: ${it.texto}${it.nota ? `  (${it.nota})` : ''}`);
    else lineas.push(`[${idx}] (sistema) ${it.texto}`);
    for (const f of porItem.get(idx) ?? []) {
      lineas.push(
        `    ↳ QUIEN PROBABA: ${f.voto === 'bien' ? 'está bien' : f.voto === 'mal' ? 'está mal' : 'comenta'}${f.nota ? ` — "${f.nota}"` : ''}`
      );
    }
  });
  const generales = feedback.filter((f) => f.item === null && f.nota);
  if (generales.length) {
    lineas.push('', 'COMENTARIO SOBRE LA PRUEBA ENTERA:');
    for (const f of generales) lineas.push(`- ${f.nota}`);
  }
  return lineas.join('\n');
}

export const SISTEMA_MEJORAS = [
  'Eres quien afina el asistente de atención de una tienda online.',
  'Recibes una conversación de prueba entre un cliente simulado y la tienda (automatizaciones y asistente), con lo que marcó quien probaba, y las reglas del negocio que el asistente ya tiene.',
  'Propón los cambios MÍNIMOS a las reglas para que la próxima vez responda como quiere el comercio.',
  '',
  'Cómo:',
  '- Edita una regla existente cuando el feedback la contradice o la completa; no dupliques reglas.',
  '- Crea una regla nueva sólo si ninguna cubre esa situación. Asígnala al asistente que contestó (agente_id) o déjala para todos (agente_id null) si vale para cualquiera.',
  '- "cuando" describe la situación en una línea; "hacer" dice qué hacer, concreto y breve, con el mismo registro y tono que las reglas existentes.',
  '- Si el feedback pide un dato que no está en la conversación ni en las reglas (un precio, un plazo, una política), escríbelo tal cual lo dijo quien probaba; no inventes.',
  '- Lo que no se arregla con una regla —una herramienta que falló, una pantalla que muestra algo mal, un mensaje de plantilla que hay que reescribir, una automatización que falta— va en "plataforma", con un prompt claro para quien lo tenga que cambiar.',
  '- Si todo lo marcado ya está cubierto, devuelve listas vacías.',
  '',
  'Contesta SÓLO un JSON:',
  '{"reglas":[{"accion":"crear"|"editar","regla_id":"<id si editas>","agente_id":"<id o null si creas>","titulo":"...","cuando":"...","hacer":"...","porque":"una línea: qué feedback resuelve"}],"plataforma":[{"problema":"una línea","prompt":"qué hay que cambiar, con el contexto necesario"}]}',
].join('\n');

export interface ReglaParaMejorar {
  id: string;
  agent_id: string | null;
  titulo: string;
  cuando: string | null;
  hacer: string;
}

/** Lo que el modelo necesita saber del comercio para proponer: asistentes y reglas. */
export function pedidoDeMejoras(
  agentes: Array<{ id: string; name: string }>,
  reglas: ReglaParaMejorar[],
  transcripcion: string
): string {
  const nombre = new Map(agentes.map((a) => [a.id, a.name]));
  return [
    'ASISTENTES:',
    ...agentes.map((a) => `- ${a.name} (agente_id ${a.id})`),
    '',
    'REGLAS ACTUALES:',
    ...reglas.map(
      (r) =>
        `- [regla_id ${r.id}] ${r.agent_id ? `(${nombre.get(r.agent_id) ?? 'otro asistente'})` : '(todos)'} «${r.titulo}»${r.cuando ? ` · Cuando: ${r.cuando}` : ''}\n  Hacer: ${r.hacer}`
    ),
    '',
    'CONVERSACIÓN DE PRUEBA:',
    transcripcion,
  ].join('\n');
}

/** Lee la respuesta del modelo. Nunca tira: lo que no se entiende, no se propone. */
export function leerPropuestas(
  salida: string | null | undefined,
  existentes: { reglas: Set<string>; agentes: Set<string> }
): Propuestas {
  const vacio: Propuestas = { reglas: [], plataforma: [] };
  if (!salida) return vacio;
  const inicio = salida.indexOf('{');
  const fin = salida.lastIndexOf('}');
  if (inicio < 0 || fin <= inicio) return vacio;
  let crudo: unknown;
  try {
    crudo = JSON.parse(salida.slice(inicio, fin + 1));
  } catch {
    return vacio;
  }
  const o = (crudo ?? {}) as { reglas?: unknown; plataforma?: unknown };
  const reglas: PropuestaDeRegla[] = [];
  for (const r of Array.isArray(o.reglas) ? o.reglas.slice(0, 10) : []) {
    const x = (r ?? {}) as Record<string, unknown>;
    const hacer = texto(x.hacer, 2000).trim();
    const titulo = texto(x.titulo, 120).trim();
    if (!hacer || !titulo) continue;
    const id = typeof x.regla_id === 'string' && existentes.reglas.has(x.regla_id) ? x.regla_id : null;
    const editar = x.accion === 'editar' && id !== null;
    reglas.push({
      accion: editar ? 'editar' : 'crear',
      regla_id: editar ? id : null,
      agente_id:
        !editar && typeof x.agente_id === 'string' && existentes.agentes.has(x.agente_id) ? x.agente_id : null,
      titulo,
      cuando: texto(x.cuando, 500).trim(),
      hacer,
      porque: texto(x.porque, 300).trim(),
    });
  }
  const plataforma: PropuestaDePlataforma[] = [];
  for (const p of Array.isArray(o.plataforma) ? o.plataforma.slice(0, 10) : []) {
    const x = (p ?? {}) as Record<string, unknown>;
    const prompt = texto(x.prompt, 3000).trim();
    if (!prompt) continue;
    plataforma.push({ problema: texto(x.problema, 300).trim(), prompt });
  }
  return { reglas, plataforma };
}
