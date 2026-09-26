import type { SupabaseClient } from '@supabase/supabase-js';
import { claveDeTelefono } from '@/lib/whatsapp/phone-utils';

/**
 * El piloto en vivo: todo lo armado —asistentes, comentarios, automatizaciones—
 * funcionando de verdad, pero con techo.
 *
 * Dos formas, combinables:
 *   - Con límites: responde N mensajes, N comentarios y arranca N
 *     automatizaciones. Al llegar, la IA queda en pausa hasta que el comercio
 *     pase a producción; un piloto no puede convertirse solo en operación
 *     completa.
 *   - Sólo para ciertos números: el asistente y las automatizaciones atienden
 *     únicamente a esos teléfonos (el del dueño, el del equipo). El resto de
 *     los clientes no recibe nada y queda para las personas.
 *
 * Sin piloto vivo no cambia nada: la puerta deja pasar. Es la única pregunta
 * que hacen el runner, los comentarios, los seguimientos y el motor de
 * automatizaciones, junto a la del motor apagado.
 */

export type TipoDeRespuesta = 'mensaje' | 'comentario' | 'automatizacion';

export type MotivoDelPiloto = 'piloto_agotado' | 'piloto_canal' | 'piloto_numero' | 'piloto_sin_cupo';

export interface Piloto {
  id: string;
  workspace_id: string;
  estado: 'borrador' | 'activo' | 'agotado' | 'terminado';
  canales: string[];
  limite_mensajes: number | null;
  limite_comentarios: number | null;
  limite_automatizaciones: number | null;
  usados_mensajes: number;
  usados_comentarios: number;
  usados_automatizaciones: number;
  solo_numeros: string[];
  iniciado_at: string | null;
  terminado_at: string | null;
  created_at: string;
  updated_at: string;
}

export const COLUMNAS_PILOTO =
  'id, workspace_id, estado, canales, limite_mensajes, limite_comentarios, limite_automatizaciones, usados_mensajes, usados_comentarios, usados_automatizaciones, solo_numeros, iniciado_at, terminado_at, created_at, updated_at';

/** El piloto que manda ahora: activo o agotado. Borrador y terminado no frenan nada. */
export async function pilotoVivo(db: SupabaseClient, workspaceId: string): Promise<Piloto | null> {
  try {
    const { data } = await db
      .from('ai_pilotos')
      .select(COLUMNAS_PILOTO)
      .eq('workspace_id', workspaceId)
      .in('estado', ['activo', 'agotado'])
      .limit(1)
      .maybeSingle();
    return (data as Piloto | null) ?? null;
  } catch {
    // Sin la tabla o sin base, el piloto no puede decidir por el comercio:
    // se comporta como si no hubiera. Es lo que ya pasaba antes de existir.
    return null;
  }
}

/**
 * Un piloto con techo: sólo ciertos números o algún límite. Es el que puede
 * correr en una cuenta que todavía no pagó (`wallet/puerta`): sin techo sería
 * producción gratis.
 */
export function pilotoConTecho(
  p: Pick<Piloto, 'solo_numeros' | 'limite_mensajes' | 'limite_comentarios' | 'limite_automatizaciones'> | null
): boolean {
  if (!p) return false;
  return (
    p.solo_numeros.length > 0 ||
    p.limite_mensajes !== null ||
    p.limite_comentarios !== null ||
    p.limite_automatizaciones !== null
  );
}

/** ¿Este teléfono está entre los habilitados? Compara en cualquier formato. */
export function numeroHabilitado(piloto: Pick<Piloto, 'solo_numeros'>, telefono: string | null | undefined): boolean {
  if (piloto.solo_numeros.length === 0) return true;
  const clave = claveDeTelefono(telefono);
  if (!clave) return false;
  return piloto.solo_numeros.some((n) => claveDeTelefono(n) === clave);
}

/** La decisión sin tocar la base: qué pasaría con este piloto. */
export function decidir(
  piloto: Piloto,
  args: {
    tipo: TipoDeRespuesta;
    canal?: string | null;
    telefono?: string | null;
    /** Algo que ya arrancó y sigue (una espera de automatización): no vuelve a contar. */
    sinCupo?: boolean;
  }
): MotivoDelPiloto | null {
  if (piloto.estado === 'agotado') return 'piloto_agotado';
  if (args.canal && piloto.canales.length > 0 && !piloto.canales.includes(args.canal)) return 'piloto_canal';
  if (!numeroHabilitado(piloto, args.telefono)) return 'piloto_numero';
  if (args.sinCupo) return null;
  const limite =
    args.tipo === 'comentario'
      ? piloto.limite_comentarios
      : args.tipo === 'automatizacion'
        ? piloto.limite_automatizaciones
        : piloto.limite_mensajes;
  const usados =
    args.tipo === 'comentario'
      ? piloto.usados_comentarios
      : args.tipo === 'automatizacion'
        ? piloto.usados_automatizaciones
        : piloto.usados_mensajes;
  if (limite !== null && usados >= limite) return 'piloto_sin_cupo';
  return null;
}

/**
 * ¿Puede salir esta respuesta? Con `reservar`, además la cuenta: la reserva es
 * atómica en la base, así que dos mensajes a la vez no se pasan del límite.
 */
export async function puertaDelPiloto(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    tipo: TipoDeRespuesta;
    canal?: string | null;
    telefono?: string | null;
    reservar?: boolean;
  }
): Promise<{ permitido: true } | { permitido: false; motivo: MotivoDelPiloto }> {
  const piloto = await pilotoVivo(db, args.workspaceId);
  if (!piloto) return { permitido: true };
  const motivo = decidir(piloto, args);
  if (motivo) return { permitido: false, motivo };
  if (args.reservar === false) return { permitido: true };
  const { data, error } = await db.rpc('reservar_cupo_piloto', { p_piloto: piloto.id, p_tipo: args.tipo });
  if (error) {
    console.warn('[piloto] no se pudo reservar el cupo:', error.message);
    return { permitido: false, motivo: 'piloto_sin_cupo' };
  }
  return data === true ? { permitido: true } : { permitido: false, motivo: 'piloto_sin_cupo' };
}

/**
 * La puerta para las automatizaciones, que salen por WhatsApp y conocen al
 * contacto por id. Con `continuar`, una espera que ya había arrancado: se
 * frena si el piloto se agotó o el contacto no está habilitado, sin contarla
 * de nuevo.
 */
export async function puertaDelPilotoParaContacto(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string | null,
  opts: { continuar?: boolean } = {}
): Promise<{ permitido: true } | { permitido: false; motivo: MotivoDelPiloto }> {
  const piloto = await pilotoVivo(db, workspaceId);
  if (!piloto) return { permitido: true };
  const telefono = piloto.solo_numeros.length > 0 ? await telefonoDelContacto(db, contactId) : null;
  const motivo = decidir(piloto, { tipo: 'automatizacion', canal: 'whatsapp', telefono, sinCupo: opts.continuar });
  if (motivo) return { permitido: false, motivo };
  if (opts.continuar) return { permitido: true };
  const { data, error } = await db.rpc('reservar_cupo_piloto', { p_piloto: piloto.id, p_tipo: 'automatizacion' });
  if (error || data !== true) return { permitido: false, motivo: 'piloto_sin_cupo' };
  return { permitido: true };
}

/** El teléfono de un contacto: el guardado o, en WhatsApp, su id externo. */
export async function telefonoDelContacto(db: SupabaseClient, contactId: string | null | undefined): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await db
    .from('contacts')
    .select('phone, external_id, channel')
    .eq('id', contactId)
    .maybeSingle();
  const c = data as { phone?: string | null; external_id?: string | null; channel?: string | null } | null;
  return c?.phone || (c?.channel === 'whatsapp' ? (c.external_id ?? null) : null);
}

/** Lo que escribe el comercio en "sólo estos números": un número por línea o separados por coma. */
export function leerNumeros(texto: unknown): string[] {
  const crudo = Array.isArray(texto) ? texto.join('\n') : typeof texto === 'string' ? texto : '';
  const out = new Set<string>();
  for (const parte of crudo.split(/[\n,;]+/)) {
    const digitos = parte.replace(/\D/g, '');
    if (digitos.length >= 8 && digitos.length <= 15) out.add(digitos);
  }
  return [...out].slice(0, 20);
}

/** Un límite escrito por el comercio: vacío = sin tope. */
export function leerLimite(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n <= 100_000 ? n : null;
}
