/**
 * Las escrituras de la bandeja, en un solo lugar.
 *
 * Estaban repartidas en tres sitios que no se hablaban: el PATCH de
 * `/api/conversations/[id]` (prender la IA), y dos `supabase.update()` sueltos
 * dentro de `message-thread.tsx` (cambiar el estado y asignar). Cada uno decidía
 * por su cuenta qué columnas laterales tocar, y ahí está el problema real: no es
 * un `status` lo que se escribe, son tres columnas que tienen que moverse
 * juntas. `closed_at` alimenta la métrica "Resueltas hoy" y `needs_human_*`
 * alimenta el contador de escalamientos de la bandeja. Un caller que se olvide
 * de una deja el tablero mintiendo, y la mentira no falla: se ve bien.
 *
 * Por eso el cuerpo vive acá y no en quien llama. La cuenta viaja siempre como
 * argumento y entra en el `.eq()`: estas funciones también las usa la capa de
 * capacidades, donde el cliente tiene llave de servicio y no hay RLS que ataje
 * un id de otro comercio.
 */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

export type EstadoConversacion = 'open' | 'pending' | 'closed'

export interface ConversacionBandeja {
  id: string
  workspace_id: string
  channel: string
  status: EstadoConversacion
  ai_enabled: boolean | null
  assigned_agent_id: string | null
  contact_id: string
  /** Nombre o teléfono del contacto: es lo que se le muestra a quien aprueba. */
  contacto: string | null
}

export interface MiembroDelEquipo {
  user_id: string
  nombre: string
  email: string | null
  rol: string
}

/**
 * El error se devuelve, no se tira.
 *
 * El PATCH de la route contesta con `serverError(error)`, que registra el error
 * real de Postgres y le devuelve al cliente un mensaje genérico. Con una
 * excepción de por medio habría que atraparla y volver a armar el objeto para
 * que `serverError` loguee lo mismo. Quien prefiera excepciones —las
 * capacidades— las arma con el `message`.
 */
type Escritura = Promise<{ error: PostgrestError | null }>

/** La conversación, recortada por cuenta. `null` si no existe o es de otra. */
export async function cargarConversacion(
  db: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<ConversacionBandeja | null> {
  const { data } = await db
    .from('conversations')
    .select(
      'id, workspace_id, channel, status, ai_enabled, assigned_agent_id, contact_id, contacts(name, phone)',
    )
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()

  const fila = data as unknown as
    | (Omit<ConversacionBandeja, 'contacto'> & {
        contacts: { name: string | null; phone: string | null } | null
      })
    | null
  if (!fila) return null

  const { contacts, ...resto } = fila
  return { ...resto, contacto: contacts?.name ?? contacts?.phone ?? null }
}

/**
 * Prende o apaga la IA en UNA conversación (migración 082).
 *
 * Volver a encenderla cierra el escalamiento: alguien ya se hizo cargo. Sin
 * esto la marca "necesita humano" quedaba pegada para siempre y el contador de
 * la bandeja no bajaba nunca. Apagarla NO la limpia — apagar la IA es
 * justamente lo que hace una persona cuando toma el hilo, y ahí la marca sigue
 * describiendo la verdad.
 */
export async function setIaConversacion(
  db: SupabaseClient,
  args: { workspaceId: string; conversationId: string; activa: boolean },
): Escritura {
  const { error } = await db
    .from('conversations')
    .update({
      ai_enabled: args.activa,
      updated_at: new Date().toISOString(),
      ...(args.activa ? { needs_human_reason: null, needs_human_at: null } : {}),
    })
    .eq('id', args.conversationId)
    .eq('workspace_id', args.workspaceId)
  return { error }
}

/**
 * Mueve el estado de una conversación.
 *
 * `closed_at` es el instante canónico de "resuelta" que lee el panel, y se
 * sella acá en vez de confiar en el trigger de `updated_at`, que también salta
 * con ediciones que no tienen nada que ver. Al reabrir se borra, o el mismo
 * hilo contaría dos veces en "Resueltas hoy".
 *
 * Sacarla de 'pending' significa que alguien la atendió, así que se cierra el
 * escalamiento. Es la misma regla que aplica la bandeja al cambiar el estado a
 * mano.
 */
export async function cambiarEstadoConversacion(
  db: SupabaseClient,
  args: { workspaceId: string; conversationId: string; estado: EstadoConversacion },
): Escritura {
  const ahora = new Date().toISOString()
  const { error } = await db
    .from('conversations')
    .update({
      status: args.estado,
      closed_at: args.estado === 'closed' ? ahora : null,
      updated_at: ahora,
      ...(args.estado === 'pending'
        ? {}
        : { needs_human_reason: null, needs_human_at: null }),
    })
    .eq('id', args.conversationId)
    .eq('workspace_id', args.workspaceId)

  // La encuesta de satisfacción NO se dispara desde acá, aunque sea el lugar
  // obvio.
  //
  // Esta función también la usa la capa de capacidades, y ahí hay una regla que
  // vale más que la comodidad: gestionar la bandeja no le escribe a nadie
  // (`capabilities/inbox.test.ts`). Un cierre en lote del Operator mandándole un
  // mensaje a cada cliente es exactamente lo que esa regla existe para impedir.
  // La pregunta sale donde alguien decidió cerrar ESTA conversación: la bandeja
  // (`/api/conversations/[id]/opinion`) y la herramienta del agente.
  return { error }
}

/**
 * Deja el hilo esperando a una persona.
 *
 * Las tres columnas se mueven juntas y por eso viven acá: apagar la IA sin
 * marcar el motivo deja una conversación muda que no aparece en el filtro
 * "necesita humano", y marcar el motivo sin apagar la IA deja al agente
 * contestando encima de la persona que viene a hacerse cargo.
 *
 * `status` va a 'pending' y no a 'open' porque es el estado que la bandeja lee
 * como "esto espera a alguien"; `cambiarEstadoConversacion` limpia el
 * escalamiento al sacarlo de ahí, así que el círculo se cierra solo.
 */
export async function pedirHumano(
  db: SupabaseClient,
  args: { workspaceId: string; conversationId: string; motivo: string },
): Escritura {
  const ahora = new Date().toISOString()
  const { error } = await db
    .from('conversations')
    .update({
      ai_enabled: false,
      status: 'pending',
      needs_human_reason: args.motivo,
      needs_human_at: ahora,
      updated_at: ahora,
    })
    .eq('id', args.conversationId)
    .eq('workspace_id', args.workspaceId)

  return { error }
}

/**
 * Pone (o saca) el dueño de una conversación.
 *
 * `assigned_agent_id` guarda un `user_id` de `auth.users` —el de un miembro del
 * equipo, no el de un agente de IA— y por eso lo que se ve en la bandeja sale
 * de `profiles.user_id`. El nombre de la columna confunde y ya costó una
 * lectura: no tiene relación con `ai_agents`.
 *
 * Tiene un efecto que no se ve: mientras esté asignada, la IA no contesta ese
 * hilo salvo que el agente tenga `reply_when_assigned` (ver `ai/runner.ts`).
 * Asignar es, además de repartir trabajo, la forma de sacar a la IA del medio.
 */
export async function asignarConversacion(
  db: SupabaseClient,
  args: { workspaceId: string; conversationId: string; userId: string | null },
): Escritura {
  const { error } = await db
    .from('conversations')
    .update({ assigned_agent_id: args.userId, updated_at: new Date().toISOString() })
    .eq('id', args.conversationId)
    .eq('workspace_id', args.workspaceId)
  return { error }
}

/**
 * A quién se le puede asignar una conversación.
 *
 * Dos consultas y no un embed: `workspace_members.user_id` apunta a
 * `auth.users` y no a `profiles`, así que no hay clave foránea que PostgREST
 * pueda seguir. Pedirlo como `profiles(...)` devuelve error y la lista queda
 * vacía — que es exactamente cómo se rompió antes la pantalla de Equipo.
 */
export async function miembrosDelEquipo(
  db: SupabaseClient,
  workspaceId: string,
): Promise<MiembroDelEquipo[]> {
  const { data: filas } = await db
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', workspaceId)

  const miembros = (filas ?? []) as { user_id: string; role: string }[]
  if (miembros.length === 0) return []

  const { data: perfiles } = await db
    .from('profiles')
    .select('user_id, full_name, email')
    .in(
      'user_id',
      miembros.map((m) => m.user_id),
    )

  const porUsuario = new Map(
    ((perfiles ?? []) as { user_id: string; full_name: string | null; email: string | null }[]).map(
      (p) => [p.user_id, p],
    ),
  )

  return miembros.map((m) => {
    const perfil = porUsuario.get(m.user_id)
    return {
      user_id: m.user_id,
      // Sin perfil el miembro existe igual (invitación aceptada sin completar
      // el alta): mostrar el correo o el id es mejor que esconderlo de la lista.
      nombre: perfil?.full_name || perfil?.email || m.user_id,
      email: perfil?.email ?? null,
      rol: m.role,
    }
  })
}

/**
 * De lo que escribe una persona al `user_id` que va en la columna.
 *
 * Quien pide una asignación conoce a su compañero por el nombre, no por su
 * uuid. Se acepta el id, el correo o el nombre; si el nombre alcanza a dos
 * personas se corta en vez de elegir una, porque asignarle el hilo a quien no
 * era se descubre tarde y mal.
 */
export function resolverMiembro(
  miembros: MiembroDelEquipo[],
  buscado: string,
): MiembroDelEquipo {
  const q = buscado.trim().toLowerCase()
  const exacto = miembros.find(
    (m) => m.user_id.toLowerCase() === q || (m.email ?? '').toLowerCase() === q,
  )
  if (exacto) return exacto

  const porNombre = miembros.filter((m) => m.nombre.toLowerCase().includes(q))
  if (porNombre.length === 1) return porNombre[0]

  const lista = miembros.map((m) => m.nombre).join(', ') || '(nadie)'
  if (porNombre.length > 1) {
    throw new Error(`"${buscado}" alcanza a varias personas: ${porNombre.map((m) => m.nombre).join(', ')}.`)
  }
  throw new Error(`"${buscado}" no es del equipo de esta cuenta. Los que hay: ${lista}.`)
}
