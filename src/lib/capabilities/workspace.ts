/**
 * Los ajustes de la cuenta: cómo se llama, en qué hora vive y quién entra.
 *
 * Las tres cosas se escribían sólo desde `workspace-panel.tsx`, con la sesión
 * del admin en el navegador. El cuerpo de esas escrituras vive ahora en
 * `@/lib/workspaces/settings`, que es lo que llaman tanto la ruta de invitar
 * como esto: si acá se reescribieran, la misma invitación daría acceso a
 * secciones distintas según por dónde se pidió.
 *
 * La zona horaria es la que más pesa de las tres y la que menos lo parece:
 * decide dónde corta el día para todas las métricas y contra qué reloj miran su
 * horario de atención las automatizaciones que ya están corriendo.
 */
import { GATEABLE_KEYS, GATEABLE_SECTIONS } from '@/lib/rbac/sections'
import { translate } from '@/lib/i18n/translate'
import { isWorkspaceAdmin } from '@/lib/workspaces/resolve'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'
import { workspaceTimezone } from '@/lib/workspaces/timezone'
import {
  cambiarZonaHoraria,
  crearInvitacion,
  esEmailValido,
  esZonaHorariaValida,
  leerAjustes,
  nombreDeCuenta,
  renombrarCuenta,
  type RolDeEquipo,
} from '@/lib/workspaces/settings'
import { leerSuscripcion } from '@/lib/billing/plan'
import { rangoDe, resumen } from '@/lib/wallet/movimientos'
import { leerBilletera } from '@/lib/wallet/saldo'
import { listarTarifas } from '@/lib/wallet/tarifas'
import type { Artefacto } from '@/lib/operator/artifacts'
import { cambio, cifras, fecha, ficha, lista, numero, tablero, tieneCampos, tt } from './vistas'
import type { Capability, CapabilityContext } from './types'

/**
 * Quién figura como responsable de la invitación.
 *
 * `workspace_invites.invited_by` es NOT NULL contra `auth.users`, así que
 * siempre tiene que haber una persona detrás. Cuando hay sesión, es esa —y se
 * comprueba que mande en la cuenta, la misma puerta que `POST /api/workspace/invite`.
 * `isWorkspaceAdmin` además acepta al dueño, que la consulta de la ruta se
 * pierde si nunca se creó su fila en `workspace_members`.
 *
 * Por MCP no hay persona: la llave ya viene recortada a ESTA cuenta, así que la
 * invitación queda a nombre del dueño, que es quien responde por ella.
 */
async function quienInvita(ctx: CapabilityContext): Promise<string> {
  const usuario =
    ctx.actor.type === 'ui' || ctx.actor.type === 'operator' ? ctx.actor.id : null
  if (usuario) {
    if (!(await isWorkspaceAdmin(ctx.db, usuario, ctx.workspaceId))) {
      throw new Error('sólo un admin de la cuenta puede sumar gente al equipo')
    }
    return usuario
  }
  const dueno = await resolveWorkspaceOwnerUserId(ctx.db, ctx.workspaceId)
  if (!dueno) throw new Error('esta cuenta no tiene dueño: no hay a nombre de quién invitar')
  return dueno
}

function rolPedido(args: Record<string, unknown>): RolDeEquipo {
  return args.rol === 'admin' ? 'admin' : 'agent'
}

/** "Bandeja, Contactos" en vez de "/bandeja, /contactos": lo lee una persona. */
function nombresDeSecciones(ctx: CapabilityContext, claves: string[]): string {
  const locale = ctx.locale ?? 'es'
  return claves
    .map((k) => {
      const seccion = GATEABLE_SECTIONS.find((s) => s.key === k)
      return seccion ? translate(locale, seccion.labelKey) : k
    })
    .join(', ')
}

function accesoQueGana(ctx: CapabilityContext, args: Record<string, unknown>): string {
  if (rolPedido(args) === 'admin') return 'administrador, con acceso a todo'
  const secciones = args.secciones
  if (!Array.isArray(secciones)) return 'agente, con acceso a todo el menú'
  const claves = secciones.filter((s): s is string => typeof s === 'string')
  if (claves.length === 0) return 'agente, sin ninguna sección del menú'
  return `agente, con acceso a ${nombresDeSecciones(ctx, claves)}`
}

// ---------------------------------------------------------------------------

async function ver(ctx: CapabilityContext) {
  return leerAjustes(ctx.db, ctx.workspaceId)
}

async function cambiarZona(ctx: CapabilityContext, args: Record<string, unknown>) {
  return cambiarZonaHoraria(ctx.db, ctx.workspaceId, args.zona_horaria)
}

async function renombrar(ctx: CapabilityContext, args: Record<string, unknown>) {
  return renombrarCuenta(ctx.db, ctx.workspaceId, args.nombre)
}

async function invitar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const invitadoPor = await quienInvita(ctx)
  const invitacion = await crearInvitacion(ctx.db, {
    workspaceId: ctx.workspaceId,
    email: args.email,
    rol: rolPedido(args),
    secciones: Array.isArray(args.secciones) ? (args.secciones as string[]) : null,
    invitadoPor,
  })
  return {
    email: invitacion.email,
    rol: invitacion.rol,
    secciones: invitacion.secciones,
    correo_entregado: invitacion.correoEntregado,
    // El enlace sólo se devuelve cuando el correo NO salió: es el token bearer
    // de la invitación y quien pregunta ya tendría que haberlo recibido por mail.
    enlace: invitacion.correoEntregado ? null : invitacion.enlace,
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LA PLATA.
//
// El chat no sabía cuánto saldo quedaba. "¿Por qué dejó de contestar la IA?"
// tiene tres respuestas posibles y una es «se quedó sin saldo»; sin esto había
// que mandar a mirar una pantalla.
//
// Se LEE y no se toca: recargar y cambiar de plan cobran a una tarjeta, y esa
// sigue siendo una decisión que se toma con el dedo, no por chat.
// ---------------------------------------------------------------------------

/** Centavos a plata legible: 12345 → "123,45 USD". */
function enPlata(centavos: number, moneda: string): string {
  const signo = centavos < 0 ? '-' : ''
  const abs = Math.abs(centavos)
  return `${signo}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')} ${moneda.toUpperCase()}`
}

async function saldo(ctx: CapabilityContext, args: Record<string, unknown>) {
  const rango = rangoDe(
    typeof args.desde === 'string' ? args.desde : null,
    typeof args.hasta === 'string' ? args.hasta : null,
  )
  const [billetera, movimiento, tarifas] = await Promise.all([
    leerBilletera(ctx.db, ctx.workspaceId),
    resumen(ctx.db, ctx.workspaceId, rango),
    listarTarifas(ctx.db),
  ])

  const moneda = billetera.moneda
  return {
    saldo: enPlata(billetera.saldoCentavos, moneda),
    saldo_centavos: billetera.saldoCentavos,
    moneda,
    // Cuánto puede quedar en rojo antes de que se corte.
    descubierto: enPlata(billetera.descubiertoCentavos, moneda),
    // Si quedarse sin saldo apaga la operación o sólo queda debiendo.
    corta_sin_saldo: billetera.bloquearSinSaldo,
    recarga_automatica: billetera.autoRecargaCentavos
      ? {
          cuanto: enPlata(billetera.autoRecargaCentavos, moneda),
          cuando_baja_de: enPlata(billetera.autoUmbralCentavos ?? 0, moneda),
        }
      : null,
    desde: rango.desde,
    hasta: rango.hasta,
    cargado: enPlata(movimiento.cargadoCentavos, moneda),
    gastado: enPlata(movimiento.gastadoCentavos, moneda),
    // En qué se fue: es la respuesta a "¿por qué gasté tanto?".
    en_que: movimiento.porConcepto.map((c) => ({
      concepto: c.concepto,
      gastado: enPlata(c.centavos, moneda),
      cantidad: c.cantidad,
    })),
    por_dia: movimiento.porDia,
    movimientos: movimiento.movimientos,
    // Cuánto sale cada cosa, para poder explicar el consumo.
    tarifas: tarifas
      .filter((t) => t.activo)
      .map((t) => ({
        concepto: t.concepto,
        que_es: ctx.locale === 'en' ? t.nombreEn : t.nombreEs,
        unidad: t.unidad,
        precio_milicentavos: t.precioMilicentavos,
      })),
  }
}

async function plan(ctx: CapabilityContext) {
  const suscripcion = await leerSuscripcion(ctx.db, ctx.workspaceId)
  if (!suscripcion) {
    return { tiene_plan: false, nota: 'Esta cuenta todavía no tiene suscripción.' }
  }
  const moneda = suscripcion.plan?.moneda ?? 'usd'
  return {
    tiene_plan: true,
    plan: suscripcion.plan?.nombre ?? null,
    estado: suscripcion.estado,
    precio: enPlata(suscripcion.precioCentavos, moneda),
    // Si el precio de ESTA cuenta no es el de lista.
    trato_propio: suscripcion.tratoPropio,
    incluidas: suscripcion.incluidas,
    excedente: enPlata(suscripcion.excedenteCentavos, moneda),
    prueba_hasta: suscripcion.pruebaHasta,
    periodo_desde: suscripcion.periodoDesde,
    periodo_hasta: suscripcion.periodoHasta,
    // Desde cuándo viene fallando el cobro: es el reloj de la gracia.
    cobro_fallando_desde: suscripcion.vencidaDesde,
    se_cancela_al_final: suscripcion.cancelarAlFinal,
    nota: suscripcion.nota,
  }
}


/**
 * La cuenta, dibujada.
 *
 * El saldo va en cifras porque son tres números que se miran juntos —cuánto
 * hay, cuánto entró, cuánto se fue— y la serie por día contesta la pregunta
 * que sigue sola: ¿desde cuándo gasto así? El plan es una ficha: son campos,
 * no magnitudes.
 */
function vistaSaldo(ctx: CapabilityContext, r: Awaited<ReturnType<typeof saldo>>): Artefacto | null {
  if (!tieneCampos(r, 'saldo', 'moneda')) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)
  const tiles = [
    { etiqueta: t('vSaldo'), valor: String(r.saldo), tono: 'neutro' as const },
    { etiqueta: t('vCargado'), valor: String(r.cargado), tono: 'neutro' as const },
    { etiqueta: t('vGastadoPeriodo'), valor: String(r.gastado), tono: 'neutro' as const },
  ]
  if (r.recarga_automatica) {
    tiles.push({
      etiqueta: t('vRecargaAutomatica'),
      valor: String(r.recarga_automatica.cuanto),
      tono: 'neutro' as const,
    })
  }
  return cifras({
    titulo: t('vTitSaldo'),
    // Sin saldo la operación se corta o queda debiendo, y son dos cosas muy
    // distintas: se dice en la bajada porque cambia la urgencia de recargar.
    bajada: r.corta_sin_saldo ? t('vCortaSinSaldo') : t('vQuedaDebiendo'),
    tiles,
    serie: lista<{ dia?: string; fecha?: string; centavos?: number; gastado?: number }>(
      r,
      'por_dia',
    ).map((d) => ({
      etiqueta: String(d.dia ?? d.fecha ?? ''),
      valor: Number(d.centavos ?? d.gastado ?? 0),
    })),
  })
}

function vistaPlan(ctx: CapabilityContext, r: Awaited<ReturnType<typeof plan>>): Artefacto | null {
  if (!tieneCampos(r, 'tiene_plan')) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)
  if (!r.tiene_plan) {
    return ficha({ titulo: t('vTitPlan'), campos: [], nota: String(r.nota ?? '') })
  }
  const chips = [String(r.estado)]
  // Un precio propio explica por qué esta cuenta no paga lo de la lista, y es
  // la primera pregunta cuando alguien compara.
  if (r.trato_propio) chips.push(t('vTratoPropio'))
  return ficha({
    titulo: String(r.plan ?? t('vTitPlan')),
    chips,
    campos: [
      { etiqueta: t('vColPrecio'), valor: String(r.precio ?? '') },
      { etiqueta: t('vIncluidas'), valor: r.incluidas != null ? numero(ctx, r.incluidas) : '' },
      { etiqueta: t('vExcedente'), valor: String(r.excedente ?? '') },
      {
        etiqueta: t('vPeriodo'),
        valor: r.periodo_hasta ? fecha(ctx, r.periodo_hasta) : '',
      },
      { etiqueta: t('vPruebaHasta'), valor: r.prueba_hasta ? fecha(ctx, r.prueba_hasta) : '' },
    ],
    // El cobro fallando es el reloj de la gracia: si no se lee, la cuenta se
    // corta sin que nadie haya visto venir nada.
    nota: r.cobro_fallando_desde
      ? `${t('vCobroFallando')} ${fecha(ctx, r.cobro_fallando_desde)}`
      : undefined,
  })
}

function vistaCuenta(ctx: CapabilityContext, r: Awaited<ReturnType<typeof ver>>): Artefacto | null {
  if (!tieneCampos(r, 'nombre')) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)
  const equipo = lista<{ nombre: string | null; email: string | null; rol: string; es_dueno: boolean }>(
    r,
    'equipo',
  )
  const invitados = lista<{ email: string; rol: string }>(r, 'invitaciones_pendientes')
  return tablero({
    titulo: String(r.nombre),
    filas: [
      { que: t('vZonaHoraria'), estado: 'ok', detalle: String(r.zona_horaria) },
      ...equipo.map((m) => ({
        que: m.nombre || m.email || t('vSinNombre'),
        estado: 'ok' as const,
        detalle: m.es_dueno ? `${m.rol} · ${t('vDueno')}` : m.rol,
      })),
      // Una invitación sin aceptar no es un miembro: se ve distinta a
      // propósito, porque esa persona todavía no entró a nada.
      ...invitados.map((i) => ({
        que: i.email,
        estado: 'apagado' as const,
        detalle: `${i.rol} · ${t('vInvitacionPendiente')}`,
      })),
    ],
  })
}

/** Lo que se cambia de la cuenta, con el antes al lado del después. */
function vistaCambioDeCuenta(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
  campo: 'nombre' | 'zona_horaria',
): Artefacto {
  const t = (k: string) => tt(ctx, `operation.${k}`)
  return cambio({
    titulo: t(campo === 'nombre' ? 'vTitRenombrar' : 'vTitZonaHoraria'),
    que: t(campo === 'nombre' ? 'vQueRenombrar' : 'vQueZonaHoraria'),
    campos: [
      {
        etiqueta: t(campo === 'nombre' ? 'vColNombre' : 'vZonaHoraria'),
        despues: String(args[campo] ?? ''),
      },
    ],
  })
}

/** A quién se invita y a qué entra. */
function vistaInvitar(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const t = (k: string) => tt(ctx, `operation.${k}`)
  return cambio({
    titulo: String(args.email ?? ''),
    que: accesoQueGana(ctx, args),
    // Una invitación llega a un correo real: no es un cambio interno.
    aviso: t('vInvitarAviso'),
  })
}
export const WORKSPACE_CAPABILITIES: Capability[] = [
  {
    key: 'ajustes.saldo',
    description:
      'El saldo de la cuenta y en qué se fue: cuánto queda, cuánto se cargó y se gastó en el rango, el detalle por concepto (respuestas de la IA, llamadas, búsquedas, imágenes) y cuánto sale cada cosa. Contesta "¿por qué gasté tanto?" y también "¿por qué dejó de contestar la IA?", que muchas veces es quedarse sin saldo.',
    descriptionEn:
      'The account balance and where it went: how much is left, how much was topped up and spent in the range, the breakdown by concept (AI replies, calls, web searches, images) and what each one costs. It answers "why did I spend so much?" and also "why did the AI stop replying?", which is often running out of balance.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha ISO. Por defecto, 30 días atrás.' },
        hasta: { type: 'string', description: 'Fecha ISO. Por defecto, ahora.' },
      },
    },
    run: saldo,
    vista: (ctx, _args, r) => vistaSaldo(ctx, r as Awaited<ReturnType<typeof saldo>>),
  },

  {
    key: 'ajustes.plan',
    description:
      'El plan de la cuenta: cuál es, en qué estado está la suscripción, qué se paga, qué incluye y cuánto sale el excedente, hasta cuándo dura la prueba y —si el cobro viene fallando— desde cuándo. Cambiar de plan NO se hace desde acá: eso cobra a una tarjeta y se toca en la pantalla de facturación.',
    descriptionEn:
      'The account plan: which one, the subscription status, what is paid, what it includes and the overage price, when the trial ends and — if billing is failing — since when. Changing plan is NOT done here: that charges a card and lives in the billing screen.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: plan,
    vista: (ctx, _args, r) => vistaPlan(ctx, r as Awaited<ReturnType<typeof plan>>),
  },
  {
    key: 'ajustes.cuenta',
    description:
      'Cómo está configurada la cuenta: su nombre, la zona horaria en la que reporta, quiénes son del equipo con su rol y a qué secciones del menú entra cada uno, y las invitaciones que todavía nadie aceptó. En "secciones", null significa acceso a todo.',
    descriptionEn:
      'How the account is configured: its name, the timezone it reports in, who is on the team with their role and which menu sections each one can open, and the invitations nobody has accepted yet. In "secciones", null means full access.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: ver,
    vista: (ctx, _args, r) => vistaCuenta(ctx, r as Awaited<ReturnType<typeof ver>>),
  },

  {
    key: 'ajustes.zona_horaria',
    description:
      'Cambia la zona horaria de la cuenta. Mueve TODOS los horarios a la vez: dónde corta el día en las métricas, la hora que se ve en la bandeja y el horario de atención que consultan las automatizaciones que ya están corriendo. Se escribe como Región/Ciudad (America/Bogota, America/Argentina/Buenos_Aires). Se deshace volviendo a la anterior.',
    descriptionEn:
      'Changes the account timezone. It moves EVERY time at once: where the day breaks for metrics, the hours shown in the inbox, and the business hours already-running automations check. Written as Region/City (America/Bogota, America/Argentina/Buenos_Aires). Undone by setting the previous one back.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        zona_horaria: {
          type: 'string',
          description: 'Zona IANA, Región/Ciudad. Ej: America/Bogota.',
        },
      },
      required: ['zona_horaria'],
    },
    async preview(ctx, args) {
      const zona = String(args.zona_horaria ?? '')
      if (!esZonaHorariaValida(zona)) {
        return `"${zona}" no es una zona horaria válida. Se escriben Región/Ciudad, como America/Bogota.`
      }
      const [actual, nombre] = await Promise.all([
        workspaceTimezone(ctx.db, ctx.workspaceId),
        nombreDeCuenta(ctx.db, ctx.workspaceId),
      ])
      if (actual === zona.trim()) return `«${nombre}» ya reporta en ${actual}: no cambiaría nada.`
      return `«${nombre}» pasaría de reportar en ${actual} a ${zona.trim()}. Cambian los horarios de toda la cuenta a la vez: el corte del día en las métricas, las horas de la bandeja y el horario de atención de las automatizaciones que ya están corriendo.`
    },
    run: cambiarZona,
    artifact: (ctx, args) => vistaCambioDeCuenta(ctx, args, 'zona_horaria'),
  },

  {
    key: 'ajustes.renombrar',
    description:
      'Cambia el nombre de la cuenta, que es el que ve el equipo en la barra lateral. No toca nada de lo que se le muestra a los clientes. Se deshace volviendo al anterior.',
    descriptionEn:
      'Changes the account name, the one the team sees in the sidebar. It touches nothing customers see. Undone by setting the previous one back.',
    risk: 'reversible',
    // Lo ve el equipo en su propia barra lateral y nadie más. No sale de la
    // cuenta ni cambia cuándo pasa nada.
    inerte: true,
    schema: {
      type: 'object',
      properties: { nombre: { type: 'string' } },
      required: ['nombre'],
    },
    async preview(ctx, args) {
      const nuevo = typeof args.nombre === 'string' ? args.nombre.trim() : ''
      if (!nuevo) throw new Error('Falta el nombre nuevo.')
      const actual = await nombreDeCuenta(ctx.db, ctx.workspaceId)
      return `La cuenta pasaría de llamarse «${actual}» a «${nuevo}».`
    },
    run: renombrar,
    artifact: (ctx, args) => vistaCambioDeCuenta(ctx, args, 'nombre'),
  },

  {
    key: 'ajustes.invitar',
    description:
      'Invita a una persona al equipo: le llega un correo y, cuando lo acepta, entra a la cuenta con el rol que se le dio. Un admin ve y toca todo; un agente entra sólo a las secciones que se le indiquen (si no se indica ninguna, entra a todo el menú). No se deshace: la invitación ya salió.',
    descriptionEn:
      'Invites a person to the team: they get an email and, once accepted, they are in the account with the given role. An admin sees and touches everything; an agent only the listed sections (with none listed, the whole menu). It cannot be undone: the email is already out.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'A dónde llega la invitación.' },
        rol: {
          type: 'string',
          enum: ['admin', 'agent'],
          description: 'Por defecto agent.',
        },
        secciones: {
          type: 'array',
          items: { type: 'string', enum: GATEABLE_KEYS },
          description: `Sólo para rol agent: a qué entra. Omitido = todo el menú; lista vacía = ninguna sección. Claves: ${GATEABLE_KEYS.join(', ')}.`,
        },
      },
      required: ['email'],
    },
    async preview(ctx, args) {
      const email = typeof args.email === 'string' ? args.email.trim() : ''
      if (!esEmailValido(email)) return `"${email}" no tiene forma de correo.`
      const nombre = await nombreDeCuenta(ctx.db, ctx.workspaceId)
      return `Le mandaría un correo a ${email.toLowerCase()} invitándolo a «${nombre}» como ${accesoQueGana(
        ctx,
        args,
      )}. Cuando lo acepte entra a la cuenta y ve los datos de los clientes. El correo no se puede cancelar una vez enviado.`
    },
    run: invitar,
    artifact: (ctx, args) => vistaInvitar(ctx, args),
  },
]
