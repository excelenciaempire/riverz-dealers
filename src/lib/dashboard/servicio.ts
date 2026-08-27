/**
 * Lo que pasa cuando no hay nadie, y lo que tarda cada uno.
 *
 * `cortes.ts` ya contesta cuánto resolvió la IA sola. Falta lo que convierte
 * ese porcentaje en un argumento: **cuántas de esas conversaciones un humano no
 * habría contestado nunca** (era de madrugada, era domingo) y **cuánto tarda
 * cada uno en dar la primera respuesta**.
 *
 * Las dos son comparaciones, no cifras sueltas. Un 87% de resolución impresiona
 * hasta que alguien pregunta "¿y una persona no lo hubiera hecho igual?". La
 * respuesta honesta a esa pregunta son estos dos números.
 */

/** El horario del comercio, tal como lo guarda `ai_agents`. */
export interface Horario {
  /** "09:00:00" */
  inicio: string | null
  /** "18:00:00" */
  fin: string | null
  /** ISO-8601: 1 = lunes … 7 = domingo. */
  dias: number[] | null
  /** IANA, del workspace. Los días se cortan acá, no en UTC. */
  tz: string
}

function minutosDelDia(hhmmss: string | null): number | null {
  if (!hhmmss) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmmss.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Hora y día de la semana de un instante, en la zona del comercio.
 *
 * Va por `Intl` y no por aritmética de offsets a propósito: el horario de
 * verano mueve el corte una hora dos veces al año, y hacerlo a mano significa
 * contar mal justo en las semanas donde alguien mira el número.
 */
export function enZona(
  iso: string,
  tz: string,
): { minutos: number; diaIso: number } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(d)
    const get = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
    const h = Number(get('hour'))
    const min = Number(get('minute'))
    const DIAS: Record<string, number> = {
      Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
    }
    const diaIso = DIAS[get('weekday')]
    if (Number.isNaN(h) || Number.isNaN(min) || !diaIso) return null
    // 24:00 aparece en algunos motores para la medianoche.
    return { minutos: (h % 24) * 60 + min, diaIso }
  } catch {
    return null
  }
}

/**
 * ¿Este mensaje entró cuando no había nadie?
 *
 * Sin horario configurado devuelve `null` — no "sí" ni "no". Es la diferencia
 * entre "sabemos que fue fuera de hora" y "no sabemos": dar por buena la
 * segunda como si fuera la primera infla la métrica con el silencio.
 *
 * Un horario que cruza la medianoche (22:00 a 06:00) se trata como un tramo que
 * da la vuelta, no como un rango vacío.
 */
export function fueraDeHorario(iso: string, h: Horario): boolean | null {
  const ini = minutosDelDia(h.inicio)
  const fin = minutosDelDia(h.fin)
  if (ini === null || fin === null) return null
  const dias = h.dias && h.dias.length > 0 ? h.dias : null
  if (!dias) return null

  const t = enZona(iso, h.tz)
  if (!t) return null

  if (!dias.includes(t.diaIso)) return true
  if (ini === fin) return false // 24 h: nunca está cerrado
  const dentro =
    ini < fin
      ? t.minutos >= ini && t.minutos < fin
      : t.minutos >= ini || t.minutos < fin
  return !dentro
}

/**
 * La mediana, no el promedio.
 *
 * Un solo hilo que quedó tres días abierto le mueve el promedio a cualquier
 * lado y deja el número irreconocible para quien atiende. La mediana dice lo
 * que pasa en el caso normal, que es lo que se está comparando.
 */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const v = [...valores].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? v[m] : Math.round((v[m - 1] + v[m]) / 2)
}

export interface Mensaje {
  conversation_id: string | null
  sender_type: string | null
  created_at: string
  /** `ai_agent` / `ai_followup` cuando habló el asistente. */
  origin?: string | null
}

export interface PrimeraRespuesta {
  /** Segundos hasta la primera respuesta, mediana. `null` = sin muestras. */
  ia: number | null
  humano: number | null
  muestrasIa: number
  muestrasHumano: number
}

/**
 * Cuánto tardó la PRIMERA respuesta de cada lado.
 *
 * Por conversación se busca el primer mensaje del cliente y la primera
 * respuesta que vino después, y se anota de quién fue. Una conversación aporta
 * a un lado o al otro, nunca a los dos: lo que se compara es quién llegó
 * primero, que es lo que vive el cliente.
 *
 * `sender_type` distingue bot de persona (`agent`), y es el mismo criterio con
 * el que la bandeja pinta cada burbuja — no se inventa una segunda definición.
 */
export function primeraRespuesta(mensajes: Mensaje[]): PrimeraRespuesta {
  const porConv = new Map<string, Mensaje[]>()
  for (const m of mensajes) {
    if (!m.conversation_id) continue
    const l = porConv.get(m.conversation_id) ?? []
    l.push(m)
    porConv.set(m.conversation_id, l)
  }

  const ia: number[] = []
  const humano: number[] = []
  for (const lista of porConv.values()) {
    lista.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    const cliente = lista.find((m) => m.sender_type === 'customer')
    if (!cliente) continue
    const t0 = Date.parse(cliente.created_at)
    const resp = lista.find(
      (m) =>
        (m.sender_type === 'bot' || m.sender_type === 'agent') &&
        Date.parse(m.created_at) > t0,
    )
    if (!resp) continue
    const segs = Math.round((Date.parse(resp.created_at) - t0) / 1000)
    if (segs < 0) continue
    if (resp.sender_type === 'bot') ia.push(segs)
    else humano.push(segs)
  }

  return {
    ia: mediana(ia),
    humano: mediana(humano),
    muestrasIa: ia.length,
    muestrasHumano: humano.length,
  }
}

export interface Escalacion {
  motivo: string
  n: number
}

/**
 * Por qué la IA devolvió el hilo a una persona.
 *
 * Va en el panel a propósito, al lado de lo que resolvió sola: un 87% sin el
 * 13% al lado se lee como marketing. Mostrar dónde se planta es lo que hace
 * creíble el resto — y además es accionable, porque cada motivo tiene un
 * arreglo distinto.
 */
export function escalacionesPorMotivo(
  convs: Array<{ needs_human_reason: string | null; needs_human_at: string | null }>,
): Escalacion[] {
  const m = new Map<string, number>()
  for (const c of convs) {
    if (!c.needs_human_at) continue
    const motivo = c.needs_human_reason ?? 'sin_motivo'
    m.set(motivo, (m.get(motivo) ?? 0) + 1)
  }
  return [...m.entries()]
    .map(([motivo, n]) => ({ motivo, n }))
    .sort((a, b) => b.n - a.n)
}
