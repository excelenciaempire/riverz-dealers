/**
 * Los ajustes de la cuenta, del lado del servidor.
 *
 * Hasta acá todo esto se escribía desde el navegador: `workspace-panel.tsx`
 * hacía los UPDATE contra Supabase con la sesión del admin y la única ruta de
 * servidor que existía era la de invitar. Eso alcanzaba mientras la única forma
 * de tocar la cuenta fuera abrir la pantalla; no alcanza para que el chat o el
 * MCP puedan hacerlo, porque del otro lado no hay navegador ni sesión.
 *
 * Acá vive lo que antes estaba disperso en los `handleX` del panel, con dos
 * cosas que el panel no necesitaba y el servidor sí:
 *
 *   - la zona horaria se VALIDA. La pantalla ofrece un <select> cerrado, así
 *     que nadie podía guardar "Bogotá" ni "+05:00"; una llamada por API sí, y
 *     una zona que `Intl` no entiende rompe todo formateo de fecha de la
 *     aplicación — el panel entero deja de dibujarse.
 *   - el nombre se recorta y se acota. Es lo que muestra la barra lateral.
 */
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publicBaseUrl } from '@/lib/base-url'
import { sanitizeSections } from '@/lib/rbac/sections'
import { listTimeZones } from '@/lib/timezones'
import { workspaceTimezone } from './timezone'

export type RolDeEquipo = 'admin' | 'agent'

export interface MiembroDelEquipo {
  nombre: string | null
  email: string | null
  rol: RolDeEquipo
  /** El dueño no se puede expulsar ni degradar: se marca para no ofrecerlo. */
  es_dueno: boolean
  desde: string | null
  /** Secciones del menú a las que entra. null = todas. */
  secciones: string[] | null
}

export interface InvitacionPendiente {
  email: string
  rol: RolDeEquipo
  expira: string
  secciones: string[] | null
}

export interface AjustesDeCuenta {
  nombre: string
  zona_horaria: string
  equipo: MiembroDelEquipo[]
  invitaciones_pendientes: InvitacionPendiente[]
}

/** Lo que muestra la barra lateral: un nombre largo la parte, no la llena. */
const LARGO_MAXIMO_NOMBRE = 80

// ---------------------------------------------------------------------------

/** El nombre de la cuenta, para los textos que lee una persona antes de aprobar. */
export async function nombreDeCuenta(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const { data } = await db
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle()
  return (data as { name?: string } | null)?.name ?? 'esta cuenta'
}

export async function leerAjustes(
  db: SupabaseClient,
  workspaceId: string,
): Promise<AjustesDeCuenta> {
  const [cuenta, zona, miembros, invitaciones] = await Promise.all([
    db
      .from('workspaces')
      .select('id, name, owner_id')
      .eq('id', workspaceId)
      .is('deleted_at', null)
      .maybeSingle(),
    // El fallback a DEFAULT_TIMEZONE lo decide un solo lugar: si acá se
    // repitiera, una cuenta sin zona cargada podría reportar una en el panel y
    // otra en el chat.
    workspaceTimezone(db, workspaceId),
    db
      .from('workspace_members')
      .select('user_id, role, joined_at, allowed_sections')
      .eq('workspace_id', workspaceId)
      .order('joined_at', { ascending: true }),
    db
      .from('workspace_invites')
      .select('email, role, expires_at, allowed_sections')
      .eq('workspace_id', workspaceId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ])

  const ws = cuenta.data as { name?: string; owner_id?: string } | null
  if (!ws) throw new Error('esa cuenta no existe o está borrada')

  const filas = (miembros.data ?? []) as Array<{
    user_id: string
    role: RolDeEquipo
    joined_at: string | null
    allowed_sections: string[] | null
  }>

  // El perfil se trae aparte, igual que en el panel: `workspace_members.user_id`
  // apunta a `auth.users` y no a `profiles`, así que no hay clave foránea que
  // PostgREST pueda embeber — pedirlo anidado devuelve error y la lista sale vacía.
  const ids = [...new Set(filas.map((m) => m.user_id).filter(Boolean))]
  const { data: perfiles } = ids.length
    ? await db.from('profiles').select('user_id, full_name, email').in('user_id', ids)
    : { data: [] as Array<{ user_id: string; full_name: string; email: string }> }
  const porUsuario = new Map(
    ((perfiles ?? []) as Array<{ user_id: string; full_name: string; email: string }>).map(
      (p) => [p.user_id, p],
    ),
  )

  return {
    nombre: ws.name ?? '',
    zona_horaria: zona,
    equipo: filas.map((m) => {
      const perfil = porUsuario.get(m.user_id)
      return {
        nombre: perfil?.full_name ?? null,
        email: perfil?.email ?? null,
        rol: m.role,
        es_dueno: m.user_id === ws.owner_id,
        desde: m.joined_at,
        secciones: m.allowed_sections ?? null,
      }
    }),
    invitaciones_pendientes: (
      (invitaciones.data ?? []) as Array<{
        email: string
        role: RolDeEquipo
        expires_at: string
        allowed_sections: string[] | null
      }>
    ).map((i) => ({
      email: i.email,
      rol: i.role,
      expira: i.expires_at,
      secciones: i.allowed_sections ?? null,
    })),
  }
}

// ---------------------------------------------------------------------------

/**
 * ¿Es una zona con la que la aplicación puede formatear una fecha?
 *
 * La lista enumerada (`Intl.supportedValuesOf`) es la que ofrece el panel, pero
 * no es toda la verdad: deja afuera los alias vivos ("Asia/Calcutta",
 * "America/Buenos_Aires"), que `Intl` acepta y formatean perfecto, y en un
 * runtime que no sabe enumerar `listTimeZones` devuelve apenas diez zonas de
 * muestra. Por eso la lista es el camino corto y el constructor es el que decide.
 *
 * Lo que no se acepta es un desplazamiento suelto ("+05:00"): desde ES2024
 * `Intl` lo toma, pero el <select> del panel no lo tiene entre sus opciones, así
 * que el comercio se quedaría sin poder ver ni cambiar lo que guardó.
 */
export function esZonaHorariaValida(zona: unknown): zona is string {
  if (typeof zona !== 'string') return false
  const z = zona.trim()
  if (!z) return false
  if (listTimeZones().includes(z)) return true
  // Región/Ciudad, o un nombre suelto como UTC. Sin números al principio: eso
  // sólo lo cumple un desplazamiento.
  if (!/^[A-Za-z]+(\/[A-Za-z0-9_+-]+)*$/.test(z)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z })
    return true
  } catch {
    return false
  }
}

/**
 * La zona en la que reporta la cuenta.
 *
 * No es un dato de presentación: decide dónde corta el día para TODAS las
 * métricas y para los horarios de atención que consultan las automatizaciones
 * mientras corren. Cambiarla mueve los horarios de todo el equipo a la vez.
 */
export async function cambiarZonaHoraria(
  db: SupabaseClient,
  workspaceId: string,
  zona: unknown,
): Promise<{ antes: string; ahora: string }> {
  if (!esZonaHorariaValida(zona)) {
    throw new Error(
      `"${String(zona)}" no es una zona horaria válida. Se escriben Región/Ciudad, como America/Bogota o America/Argentina/Buenos_Aires.`,
    )
  }
  const ahora = zona.trim()
  const antes = await workspaceTimezone(db, workspaceId)

  const { data, error } = await db
    .from('workspaces')
    .update({ timezone: ahora, updated_at: new Date().toISOString() })
    .eq('id', workspaceId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('esa cuenta no existe o está borrada')

  return { antes, ahora }
}

export async function renombrarCuenta(
  db: SupabaseClient,
  workspaceId: string,
  nombre: unknown,
): Promise<{ antes: string; ahora: string }> {
  const limpio = typeof nombre === 'string' ? nombre.trim() : ''
  if (!limpio) throw new Error('el nombre de la cuenta no puede quedar vacío')
  if (limpio.length > LARGO_MAXIMO_NOMBRE) {
    throw new Error(`el nombre no puede pasar de ${LARGO_MAXIMO_NOMBRE} caracteres`)
  }
  const antes = await nombreDeCuenta(db, workspaceId)

  const { data, error } = await db
    .from('workspaces')
    .update({ name: limpio, updated_at: new Date().toISOString() })
    .eq('id', workspaceId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('esa cuenta no existe o está borrada')

  return { antes, ahora: limpio }
}

// ---------------------------------------------------------------------------

/**
 * Distingue "el correo está mal escrito" (400, lo arregla quien pide) de "no se
 * pudo guardar" (el error de la base, que no se le muestra a nadie).
 */
export class ErrorDeInvitacion extends Error {
  constructor(
    readonly codigo: 'email' | 'guardar',
    message: string,
    readonly causa?: unknown,
  ) {
    super(message)
    this.name = 'ErrorDeInvitacion'
  }
}

/**
 * Forma de correo, no existencia.
 *
 * La puerta de aceptación compara el correo invitado con el de quien entra,
 * sin distinguir mayúsculas: una invitación para "no-es-un-correo" nunca se
 * podría canjear, así que se rechaza al crearla y no cuando ya es tarde.
 */
export function esEmailValido(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export interface InvitacionCreada {
  email: string
  rol: RolDeEquipo
  secciones: string[] | null
  /** El enlace para aceptar. Lleva el token: es un secreto. */
  enlace: string
  /** false = la invitación existe pero el correo no salió: hay que pasar el enlace a mano. */
  correoEntregado: boolean
}

/**
 * Crea la invitación y trata de entregarla.
 *
 * Era el cuerpo de `POST /api/workspace/invite`. Se movió tal cual para que la
 * capacidad no tuviera que reescribirlo: dos versiones de esto significan dos
 * criterios distintos sobre qué secciones quedan concedidas, y ahí es donde se
 * regala acceso sin querer.
 *
 * La autorización NO está acá a propósito: la ruta la resuelve con la sesión y
 * la capacidad con el actor del contexto. Esta función confía en `invitadoPor`.
 */
export async function crearInvitacion(
  db: SupabaseClient,
  params: {
    workspaceId: string
    email: unknown
    rol?: RolDeEquipo
    /** null / ausente = acceso completo. Array = sólo esas secciones. */
    secciones?: string[] | null
    /** auth.users.id de quien invita. La columna es NOT NULL. */
    invitadoPor: string
    /** Desde dónde se arma el enlace. Por defecto, el dominio público. */
    baseUrl?: string
  },
): Promise<InvitacionCreada> {
  if (!esEmailValido(params.email)) {
    throw new ErrorDeInvitacion('email', 'ese correo no tiene forma de correo')
  }
  const email = params.email.trim().toLowerCase()
  const rol: RolDeEquipo = params.rol === 'admin' ? 'admin' : 'agent'
  // Un admin siempre entra a todo: su rol ya lo implica. Para un agente, un
  // array explícito lo recorta y `null` (o ausente) lo deja completo; '{}' es
  // "ninguna sección", que es una elección válida y no un olvido.
  const secciones =
    rol === 'admin' || params.secciones == null ? null : sanitizeSections(params.secciones)

  const token = crypto.randomBytes(24).toString('hex')
  const { error } = await db.from('workspace_invites').insert({
    workspace_id: params.workspaceId,
    email,
    role: rol,
    token,
    invited_by: params.invitadoPor,
    allowed_sections: secciones,
  })
  if (error) {
    throw new ErrorDeInvitacion('guardar', 'no se pudo crear la invitación', error)
  }

  const enlace = new URL(`/invitacion/${token}`, params.baseUrl || publicBaseUrl()).toString()

  // Entrega. Supabase Auth tiene un endpoint transaccional de invitación; lo
  // usamos cuando hay SMTP configurado (servidor propio o por debajo de la cuota
  // gratuita). En una instancia sin SMTP devuelve 500: nos lo tragamos y
  // devolvemos `correoEntregado: false` para que quien invitó pase el enlace a
  // mano en vez de creer que ya llegó.
  let correoEntregado = false
  try {
    const { error: inviteErr } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: enlace,
      data: { workspace_id: params.workspaceId, invite_token: token },
    })
    if (!inviteErr) correoEntregado = true
    else console.warn('[workspace/invite] inviteUserByEmail failed:', inviteErr.message)
  } catch (e) {
    console.warn('[workspace/invite] inviteUserByEmail threw:', e)
  }

  if (!correoEntregado) {
    // El token es el secreto bearer del flujo: en producción no va a los logs.
    // El enlace viaja en la respuesta a quien ya está autenticado.
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        `[workspace/invite] would-send-invite-to=${email} link=${enlace} (SMTP not configured)`,
      )
    } else {
      console.info(
        `[workspace/invite] invite created for=${email} (SMTP not configured; accept_url devuelto en la respuesta)`,
      )
    }
  }

  return { email, rol, secciones, enlace, correoEntregado }
}
