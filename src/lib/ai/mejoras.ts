import type { SupabaseClient } from '@supabase/supabase-js';
import { completeTextMedido } from '@/lib/ai/medido';
import { MAX_REGLAS } from '@/lib/ai/guidance';
import {
  leerPropuestas,
  pedidoDeMejoras,
  SISTEMA_MEJORAS,
  type ItemGuardado,
  type PropuestaDeRegla,
  type Propuestas,
  type ReglaParaMejorar,
} from '@/lib/ai/sesiones-de-prueba';

/**
 * De feedback a cambios, para las pruebas y para las conversaciones reales.
 *
 * El feedback se convierte en dos cosas distintas y nunca se mezclan:
 *   - reglas del comercio (crear o editar), que se revisan y se aplican con un
 *     clic, o solas si el comercio activó "Aplicar mejoras solas";
 *   - lo que no se arregla con una regla (una herramienta, una pantalla, una
 *     plantilla), que va a la cola del equipo de Riverz (`mejoras_plataforma`).
 */

const MAX_TITULO = 80;
const MAX_CUANDO = 500;
const MAX_HACER = 1500;

/** Pide a la IA las mejoras para una conversación con sus marcas, ya en texto. */
export async function generarPropuestas(
  admin: SupabaseClient,
  args: { workspaceId: string; transcripcion: string; referenciaTipo: string; referenciaId: string | null }
): Promise<Propuestas | null> {
  const [{ data: agentes }, { data: reglas }] = await Promise.all([
    admin.from('ai_agents').select('id, name').eq('workspace_id', args.workspaceId).is('deleted_at', null),
    admin
      .from('agent_guidance')
      .select('id, agent_id, titulo, cuando, hacer')
      .eq('workspace_id', args.workspaceId)
      .eq('activa', true)
      .order('orden', { ascending: true }),
  ]);
  const listaAgentes = (agentes ?? []) as Array<{ id: string; name: string }>;
  const listaReglas = (reglas ?? []) as ReglaParaMejorar[];
  const salida = await completeTextMedido(admin, {
    workspaceId: args.workspaceId,
    concepto: 'ia_asistencia',
    referenciaTipo: args.referenciaTipo,
    referenciaId: args.referenciaId,
    tier: 'premium',
    effort: 'medium',
    maxTokens: 4000,
    system: SISTEMA_MEJORAS,
    user: pedidoDeMejoras(listaAgentes, listaReglas, args.transcripcion),
  });
  if (salida === null) return null;
  return {
    ...leerPropuestas(salida, {
      reglas: new Set(listaReglas.map((r) => r.id)),
      agentes: new Set(listaAgentes.map((a) => a.id)),
    }),
    generadas_at: new Date().toISOString(),
  };
}

export type ResultadoDeAplicar =
  | { ok: true; propuesta: PropuestaDeRegla }
  | { ok: false; status: number; clave: string; params?: Record<string, string | number> };

/**
 * Aplica una regla propuesta, con lo que haya corregido quien la revisó.
 * Guarda cómo estaba la regla antes de editarla, para poder volver atrás.
 */
export async function aplicarReglaPropuesta(
  admin: SupabaseClient,
  workspaceId: string,
  propuesta: PropuestaDeRegla,
  cambios: { titulo?: unknown; cuando?: unknown; hacer?: unknown } = {}
): Promise<ResultadoDeAplicar> {
  const texto = (v: unknown, fallback: string, max: number) =>
    (typeof v === 'string' ? v : fallback).trim().slice(0, max);
  const titulo = texto(cambios.titulo, propuesta.titulo, MAX_TITULO);
  const cuando = texto(cambios.cuando, propuesta.cuando, MAX_CUANDO) || null;
  const hacer = texto(cambios.hacer, propuesta.hacer, MAX_HACER);
  if (!titulo || !hacer) return { ok: false, status: 400, clave: 'bad_request' };

  if (propuesta.accion === 'editar' && propuesta.regla_id) {
    const { data: antes } = await admin
      .from('agent_guidance')
      .select('titulo, cuando, hacer')
      .eq('workspace_id', workspaceId)
      .eq('id', propuesta.regla_id)
      .maybeSingle();
    if (!antes) return { ok: false, status: 404, clave: 'assistant.pruebasReglaNoExiste' };
    const { error } = await admin
      .from('agent_guidance')
      .update({ titulo, cuando, hacer, activa: true, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', propuesta.regla_id);
    if (error) return { ok: false, status: 500, clave: 'errAi.testGenerateFailed' };
    return {
      ok: true,
      propuesta: { ...propuesta, titulo, cuando: cuando ?? '', hacer, aplicada: true, antes: antes as PropuestaDeRegla['antes'] },
    };
  }

  // Al prompt de cada asistente entran como mucho MAX_REGLAS (las de todos
  // más las suyas): una regla que queda afuera es una promesa que no pasa.
  const { data: activas } = await admin
    .from('agent_guidance')
    .select('agent_id')
    .eq('workspace_id', workspaceId)
    .eq('activa', true);
  const lista = (activas ?? []) as Array<{ agent_id: string | null }>;
  const globales = lista.filter((r) => r.agent_id === null).length;
  const propias = (agente: string) => lista.filter((r) => r.agent_id === agente).length;
  const afectados = propuesta.agente_id
    ? [propuesta.agente_id]
    : [...new Set(lista.map((r) => r.agent_id).filter((a): a is string => a !== null))];
  const lleno = propuesta.agente_id
    ? globales + propias(propuesta.agente_id) >= MAX_REGLAS
    : globales >= MAX_REGLAS || afectados.some((a) => globales + propias(a) >= MAX_REGLAS);
  if (lleno) return { ok: false, status: 409, clave: 'assistant.pruebasTopeReglas', params: { n: MAX_REGLAS } };

  const { data: ultima } = await admin
    .from('agent_guidance')
    .select('orden')
    .eq('workspace_id', workspaceId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: creada, error } = await admin
    .from('agent_guidance')
    .insert({
      workspace_id: workspaceId,
      agent_id: propuesta.agente_id,
      titulo,
      cuando,
      hacer,
      activa: true,
      orden: ((ultima as { orden?: number } | null)?.orden ?? 0) + 1,
      origen: 'comercio',
    })
    .select('id')
    .single();
  if (error) return { ok: false, status: 500, clave: 'errAi.testGenerateFailed' };
  return {
    ok: true,
    propuesta: {
      ...propuesta,
      titulo,
      cuando: cuando ?? '',
      hacer,
      aplicada: true,
      regla_creada_id: (creada as { id: string }).id,
    },
  };
}

/** Lo que no se arregla con una regla, a la cola del equipo de Riverz. */
export async function encolarParaPlataforma(
  admin: SupabaseClient,
  args: { workspaceId: string; origen: 'prueba' | 'bandeja'; origenId: string | null; propuestas: Propuestas }
): Promise<void> {
  if (!args.propuestas.plataforma.length) return;
  const { error } = await admin.from('mejoras_plataforma').insert(
    args.propuestas.plataforma.map((p) => ({
      workspace_id: args.workspaceId,
      origen: args.origen,
      origen_id: args.origenId,
      problema: p.problema,
      prompt: p.prompt,
    }))
  );
  if (error) console.warn('[mejoras] no se pudo encolar para la plataforma:', error.message);
}

/** ¿El comercio pidió que las reglas propuestas se apliquen solas? */
export async function aplicaSolas(admin: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data } = await admin.from('workspaces').select('mejoras_automaticas').eq('id', workspaceId).maybeSingle();
  return (data as { mejoras_automaticas?: boolean } | null)?.mejoras_automaticas === true;
}

/** Con "Aplicar mejoras solas", aplica cada regla propuesta y devuelve cómo quedaron. */
export async function aplicarSolasSiCorresponde(
  admin: SupabaseClient,
  workspaceId: string,
  propuestas: Propuestas
): Promise<Propuestas> {
  if (!propuestas.reglas.length || !(await aplicaSolas(admin, workspaceId))) return propuestas;
  const reglas: PropuestaDeRegla[] = [];
  for (const r of propuestas.reglas) {
    if (r.aplicada) {
      reglas.push(r);
      continue;
    }
    const res = await aplicarReglaPropuesta(admin, workspaceId, r);
    reglas.push(res.ok ? { ...res.propuesta, automatica: true } : r);
  }
  return { ...propuestas, reglas };
}

/**
 * Las marcas del equipo sobre conversaciones reales, en texto para el modelo:
 * cada tramo con lo que dijo quien lo marcó.
 */
export function transcripcionDeFeedbackReal(
  filas: Array<{ captura: ItemGuardado[]; voto: 'bien' | 'mal' | null; nota: string }>
): string {
  return filas
    .map((f, i) => {
      const lineas = f.captura.map((it) =>
        it.k === 'me' ? `CLIENTE: ${it.texto}` : it.k === 'biz' ? `TIENDA: ${it.texto}${it.nota ? `  (${it.nota})` : ''}` : `(sistema) ${it.texto}`
      );
      const marca = `↳ EQUIPO sobre el último mensaje de la tienda: ${f.voto === 'bien' ? 'está bien' : f.voto === 'mal' ? 'está mal' : 'comenta'}${f.nota ? ` — "${f.nota}"` : ''}`;
      return [`CONVERSACIÓN ${i + 1}:`, ...lineas, marca].join('\n');
    })
    .join('\n\n');
}

/** Tapa teléfonos y correos para quien no es del comercio (el panel de Riverz). */
export function taparDatos(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '•••@•••')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '•••••••' : m));
}
