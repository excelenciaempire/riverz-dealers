'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUp,
  Check,
  History,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { TextoRico } from '@/components/ui/texto-rico'
import {
  agrupar,
  aplicarEvento,
  aplicarEventoDePlan,
  type Bloque,
} from '@/lib/operator/bloques'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { drainEvents } from '@/lib/operator/events'
import type { Artefacto } from '@/lib/operator/artifacts'
import type { ResumenHilo } from '@/lib/operator/threads'
import { useMesa, useMesaDispatch } from './mesa-contexto'
import { cn } from '@/lib/utils'

/**
 * El Operator, dentro del Centro de Operación.
 *
 * Lo que el Operator propone NO está hecho: aparece como una tarjeta con lo
 * que haría y dos botones. Esa separación es la que permite que lea datos
 * escritos por clientes —donde alguien podría esconder una instrucción— sin
 * que eso alcance para cambiar nada.
 */

interface Mensaje {
  id: string
  role: 'user' | 'assistant'
  text: string
  /**
   * El turno tal como se vio ocurrir. Se conserva después de terminar: haber
   * mirado cómo lo armaba y que después quede sólo un párrafo borra la parte
   * que explica de dónde salió cada cosa.
   */
  bloques?: Bloque[]
}

interface Accion {
  id: string
  capability_key: string
  args: Record<string, unknown>
  risk: 'lectura' | 'reversible' | 'irreversible'
  status: 'propuesto' | 'ejecutado' | 'rechazado' | 'fallido'
  preview: string | null
}

/** Las que cambian algo: la línea viva dice «Armando», no «Mirando». */
const VERBOS_QUE_ESCRIBEN =
  /\.(crear|editar|activar|enviar|lanzar|borrar|etiquetar|decidir|desconectar|invitar|llamar|checkout|registrar)/

function escribe(key: string): boolean {
  return VERBOS_QUE_ESCRIBEN.test(key)
}

/**
 * El dominio del que habla algo: una clave de capacidad o un especialista.
 *
 * `bandeja` y `contactos` cubren más de un dominio; se los nombra por el suyo
 * principal, que es de lo que hablan el 90% del tiempo.
 */
const DOMINIO_DEL_ESPECIALISTA: Record<string, string> = {
  bandeja: 'conversaciones',
  contactos: 'contactos',
}

function dominioDe(clave: string): string {
  const base = clave.includes('.') ? clave.split('.')[0] : clave
  return DOMINIO_DEL_ESPECIALISTA[base] ?? base
}

function cap(s: string): string {
  return `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`
}

/** «Las plantillas» → «las plantillas», para que entre en una frase. */
function enMinuscula(s: string): string {
  return `${s[0]?.toLowerCase() ?? ''}${s.slice(1)}`
}

/**
 * La primera frase de una vista previa: lo que la decisión necesita.
 *
 * Las vistas previas traen el detalle completo —el cuerpo de la plantilla, los
 * pasos, el aviso— porque también son lo que se lee al revisar. En la tarjeta,
 * tres cuerpos de doscientos caracteres tachados no son una decisión: son un
 * muro. Se corta en el primer dos puntos o punto y el resto se mira en el banco,
 * donde el mensaje se ve como le va a llegar a alguien.
 */
function alGrano(texto: string): string {
  const corte = texto.search(/[:.]\s/)
  const corto = corte > 20 ? texto.slice(0, corte) : texto
  return corto.length > 96 ? `${corto.slice(0, 95)}…` : corto
}

/** Las que dejan una automatización nueva y dormida: se ofrece prenderla. */
const CREAN_AUTOMATIZACION = [
  'automatizaciones.crear',
  'automatizaciones.crear_desde_receta',
]

/** La primera frase de un texto. Lo que se muestra de un encargo. */
function primeraFrase(texto: string): string {
  const m = texto.match(/^[^.!?]*[.!?]/)
  const f = (m ? m[0] : texto).trim()
  return f.length > 4 ? f : texto.trim()
}

interface PlanPendiente {
  planId: string
  porque: string
  pasos: { i: number; agente: string; que: string; encargo: string; dependeDe: number[] }[]
  estado: 'esperando' | 'corriendo' | 'listo' | 'rechazado'
}

/** El turno en curso. */
interface Vivo {
  /** Razonamiento del modelo, cuando lo expone (ver `events.ts`). */
  thinking: string
  bloques: Bloque[]
}

export function OperatorChat({
  onChanged,
  fullscreen = false,
}: {
  onChanged?: () => void
  /**
   * El chat como pantalla y no como panel: sin marco ni encabezado (la barra
   * de pestañas ya dice dónde estás) y con la conversación en una columna
   * centrada, que es lo que hace legible un hilo largo en una pantalla ancha.
   */
  fullscreen?: boolean
}) {
  const t = useT()
  const fetchWithCsrf = useFetchWithCsrf()
  // La mesa de trabajo es HERMANA del chat, no hija: se le pasan los eventos
  // por contexto en vez de levantar el estado, para no tener que reescribir el
  // lector del stream.
  const aLaMesa = useMesaDispatch()
  const mesa = useMesa()
  const [thread, setThread] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [acciones, setAcciones] = useState<Accion[]>([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [vivo, setVivo] = useState<Vivo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hilos, setHilos] = useState<ResumenHilo[]>([])
  /**
   * El reparto que quedó esperando un click.
   *
   * Vive en el chat y no en la mesa porque es una DECISIÓN, y las decisiones
   * están donde están las otras: junto a las tarjetas de aprobación, al final
   * del hilo. La mesa lo muestra también, pero de sólo lectura.
   */
  const [plan, setPlan] = useState<PlanPendiente | null>(null)
  const [cargandoHilo, setCargandoHilo] = useState(false)
  /**
   * Lo que quedó dicho y no es una decisión.
   *
   * Hoy sólo una cosa: «quedó pausada porque le falta X». Es información, y va
   * escrita, no como un botón que no puede funcionar.
   */
  const [notas, setNotas] = useState<string[]>([])
  /**
   * La corrida que está pasando ahora, si hay una.
   *
   * Un turno vive en el servidor y sigue aunque nadie mire. Esto es el hilo
   * suelto que lo ata a la pantalla: mientras haya id, se está mirando algo
   * que corre, y se puede detener.
   */
  const [corrida, setCorrida] = useState<string | null>(null)
  const finalRef = useRef<HTMLDivElement | null>(null)
  /**
   * `enviar` en una caja, porque se declara DESPUÉS de quien la llama.
   *
   * `resolver` necesita seguir la conversación al aprobar, y mover `enviar`
   * arriba significaría mover con ella medio componente. La caja se llena en
   * cuanto `enviar` existe.
   */
  const enviarRef = useRef<((texto: string) => Promise<void>) | null>(null)
  /**
   * El hilo abierto AHORA, no el que estaba abierto al empezar.
   *
   * Una corrida puede tardar minutos y en el medio se puede cambiar de
   * conversación o abrir una nueva. Leer `thread` de la clausura hacía que al
   * terminar se releyera el hilo viejo, pisando el que la persona acababa de
   * abrir.
   */
  const threadRef = useRef<string | null>(null)
  threadRef.current = thread
  /** Que la apertura automática pase UNA vez, al entrar. */
  const yaArranco = useRef(false)
  /** Lo último concreto que se estaba haciendo, para no caer en genérico. */
  const ultimaActividad = useRef('')
  /** Cuándo arrancó lo que está corriendo, para contar los segundos. */
  const [arrancoEn, setArrancoEn] = useState<number | null>(null)

  /**
   * Abre una conversación anterior.
   *
   * Cada hilo es su propio contexto: lo que se habló en uno no entra en el
   * otro. Eso ya era cierto en el servidor, pero no se podía usar porque la
   * pantalla abría un hilo nuevo en cada carga y no había forma de volver a
   * ninguno. Se guardaba todo y no se leía nada.
   */
  const abrirHilo = useCallback(async (id: string) => {
    setCargandoHilo(true)
    setError(null)
    try {
      const res = await fetch(`/api/operacion/operator?thread=${id}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('no se pudo')
      const json = (await res.json()) as {
        mensajes?: { id: string; role: 'user' | 'assistant'; text: string }[]
        acciones?: Accion[]
        plan?: Omit<PlanPendiente, 'estado'> | null
      }
      const ms = (json.mensajes ?? []) as Mensaje[]
      setThread(id)
      setMensajes(ms)
      setAcciones(json.acciones ?? [])
      // El plan que quedó esperando. Vivía sólo en la memoria de la pestaña
      // que lo vio nacer: al volver, la tarjeta no estaba y el plan se quedaba
      // en la base sin forma de aprobarlo.
      setPlan(json.plan ? { ...json.plan, estado: 'esperando' } : null)
      setVivo(null)
      // El banco vuelve a lo que había. Los dibujos ya se guardan con el
      // mensaje; lo que faltaba era volver a ponerlos, así que hasta ahora la
      // pieza vivía sólo en la memoria del turno que la armó y volver a la
      // conversación dejaba media pantalla vacía.
      aLaMesa({
        tipo: 'restaurar',
        lienzos: ms
          .flatMap((m) => m.bloques ?? [])
          .flatMap((b) =>
            b.k === 'paso' && b.artefacto
              ? [{ agente: 'automatizaciones' as const, artefacto: b.artefacto }]
              : [],
          )
          // TODAS, no la última. Con `slice(-1)` volver a la conversación
          // dejaba una sola plantilla de tres en el panel: las otras dos se
          // habían armado, se veían mientras corría, y desaparecían al recargar.
          ,
      })
    } catch {
      setError(t('operation.operatorError'))
    } finally {
      setCargandoHilo(false)
    }
  }, [aLaMesa, t])

  /**
   * Vuelve a mirar un turno que sigue corriendo.
   *
   * No lo reinicia: pregunta cómo va y va pintando la foto hasta que termina.
   * La foto es el mismo par texto+bloques que se guarda con el mensaje
   * terminado, así que lo que se ve mientras corre y lo que queda después no
   * pueden diferir.
   */
  const retomar = useCallback(
    async (runId: string) => {
      setCorrida(runId)
      setPensando(true)
      setArrancoEn(Date.now())
      try {
        for (;;) {
          const res = await fetch(`/api/operacion/operator/corridas?id=${runId}`, {
            cache: 'no-store',
          })
          if (!res.ok) break
          const { corrida: c } = (await res.json()) as {
            corrida: {
              estado: string
              texto: string
              bloques: Bloque[]
            } | null
          }
          if (!c) break
          setVivo({ thinking: '', bloques: c.bloques ?? [] })
          if (c.estado !== 'corriendo') break
          await new Promise((r) => setTimeout(r, 1200))
        }
      } catch {
        /* si se corta, queda lo último que se vio */
      } finally {
        setCorrida(null)
        setPensando(false)
        setVivo(null)
        // El turno terminado ya está guardado con el mensaje: se relee el hilo
        // en vez de armarlo acá con la foto, que es la versión de al lado.
        //
        // Y se relee el que está abierto AHORA: entre que la corrida empezó y
        // terminó puede haber pasado un «Chat nuevo».
        const actual = threadRef.current
        if (actual) await abrirHilo(actual)
      }
    },
    // Sin `thread`: viaja por la caja. Tenerlo acá recreaba esta función en
    // cada cambio de hilo, y con ella el efecto que abre la última.
    [abrirHilo],
  )

  /**
   * Al entrar, la conversación donde la dejaste.
   *
   * Esto sólo pedía la lista y no abría ninguna, así que entrar al Operador
   * era siempre empezar de cero: el historial guardaba todo y la pantalla no
   * leía nada. «Chat nuevo» sigue a un click para cuando sí se quiere empezar
   * de cero.
   */
  useEffect(() => {
    // Una vez y nada más. Esto tenía a `retomar` en las dependencias, que
    // depende del hilo: tocar «Chat nuevo» ponía el hilo en null, `retomar`
    // cambiaba de identidad, el efecto se volvía a montar y abría la
    // conversación anterior. Abrir la última al ENTRAR es lo que se quería;
    // volver a abrirla cada vez que cambia el hilo es lo contrario.
    if (yaArranco.current) return
    yaArranco.current = true

    let cancelado = false
    void (async () => {
      try {
        const res = await fetch('/api/operacion/operator', { cache: 'no-store' })
        if (!res.ok || cancelado) return
        const json = (await res.json()) as { hilos?: ResumenHilo[] }
        if (cancelado) return
        const hs = json.hilos ?? []
        setHilos(hs)
        if (hs[0]) await abrirHilo(hs[0].id)
        // ¿Quedó algo corriendo? Salir de la pantalla no cancela nada, así
        // que al volver se sigue mirando desde donde iba.
        if (hs[0]) {
          const r = await fetch(`/api/operacion/operator/corridas?thread=${hs[0].id}`, {
            cache: 'no-store',
          })
          if (r.ok && !cancelado) {
            const { corrida: c } = (await r.json()) as { corrida: { id: string } | null }
            if (c) void retomar(c.id)
          }
        }
      } catch {
        /* sin historial se empieza en blanco, que es lo que ya pasaba */
      }
    })()
    return () => {
      cancelado = true
    }
  }, [abrirHilo, retomar])

  /** Empezar de cero. El hilo anterior queda guardado y accesible. */
  const nuevoChat = useCallback(() => {
    // Sin esto quedan en la mesa los agentes del turno anterior, trabajando
    // sobre una conversación que ya no existe.
    aLaMesa({ tipo: 'limpiar' })
    setPlan(null)
    setThread(null)
    setMensajes([])
    setAcciones([])
    setVivo(null)
    setError(null)
    setTexto('')
    setNotas([])
    // Y se suelta la corrida: el boton de detener apuntaria al turno de la
    // conversacion anterior, que no es la que se esta mirando.
    setCorrida(null)
  }, [aLaMesa])

  const borrarChat = useCallback(
    async (id: string) => {
      // Optimista: si falla, la lista se repone sola en la próxima carga.
      setHilos((hs) => hs.filter((h) => h.id !== id))
      if (id === thread) nuevoChat()
      try {
        await fetchWithCsrf(`/api/operacion/operator?thread=${id}`, { method: 'DELETE' })
      } catch {
        /* silencioso: borrar es una comodidad, no una operación crítica */
      }
    },
    [fetchWithCsrf, nuevoChat, thread],
  )

  const enviar = useCallback(
    async (valor: string) => {
      const limpio = valor.trim()
      if (!limpio || pensando) return
      setError(null)
      setTexto('')
      setMensajes((m) => [...m, { id: `local-${m.length}`, role: 'user', text: limpio }])
      setPensando(true)
      setArrancoEn(Date.now())
      setVivo({ thinking: '', bloques: [] })

      try {
        const res = await fetchWithCsrf('/api/operacion/operator', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texto: limpio, thread }),
        })
        if (res.status === 429) {
          setError(t('operation.operatorRateLimited'))
          return
        }
        // Ya había un turno corriendo sobre este hilo: en vez de abrir otro
        // —dos se pisan el contexto— se mira el que está.
        if (res.status === 409) {
          const { run } = (await res.json()) as { run?: string }
          if (run) void retomar(run)
          return
        }
        const idCorrida = res.headers.get('x-riverz-run')
        if (idCorrida) setCorrida(idCorrida)
        if (!res.ok || !res.body) throw new Error('failed')

        // Se lee a medida que llega. `getReader()` y no `EventSource` porque
        // este POST lleva el token CSRF en una cabecera, y EventSource no puede
        // mandar cabeceras.
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buffer = ''
        let final = ''
        let hilo = thread
        let bloques: Bloque[] = []
        let thinking = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          // `stream: true` mantiene a medias los caracteres partidos entre dos
          // chunks: sin eso una tilde cortada rompe el JSON de esa línea.
          buffer += dec.decode(value, { stream: true })
          const { events, rest } = drainEvents(buffer)
          buffer = rest

          for (const e of events) {
            // Todo va a la mesa; el hilo se queda sólo con lo que le toca.
            aLaMesa({ tipo: 'evento', e })
            if (e.t === 'plan') {
              setPlan({
                planId: e.planId,
                porque: e.porque,
                pasos: e.pasos,
                estado: 'esperando',
              })
            } else if (e.t === 'thinking') {
              thinking += e.delta
            } else if (e.t === 'error') {
              setError(e.message)
            } else if (e.t === 'done') {
              hilo = e.thread
            }
            if (e.t === 'text') final += e.delta
            // El mismo reductor que usa el servidor para guardar el turno: con
            // dos copias, el hilo se veía de una forma en vivo y de otra al
            // recargarlo.
            bloques = aplicarEvento(bloques, e)
          }
          // Un solo repintado por chunk y no uno por evento: con deltas de
          // texto llegando de a decenas, actualizar en cada uno hace parpadear
          // la lista sin que se vea más fluido.
          setVivo({ thinking, bloques })
        }

        setThread(hilo)
        // El turno queda como se vio: los pasos y el texto en su orden, no un
        // párrafo suelto que borra de dónde salió cada dato.
        if (final.trim() || bloques.length > 0) {
          setMensajes((m) => [
            ...m,
            { id: `a-${m.length}`, role: 'assistant', text: final, bloques },
          ])
        }
        // En el MISMO lote que el mensaje, no en el `finally`.
        //
        // Estaba después de volver a pedir las acciones, así que durante ese
        // medio segundo el turno se dibujaba dos veces —una como mensaje
        // guardado y otra como turno en vivo— y al llegar la respuesta la copia
        // desaparecía sola. Eso era el texto que aparecía y se iba.
        setVivo(null)
        // La lista autoritativa de acciones sale del servidor: el stream sólo
        // avisa que quedó algo propuesto, no con qué argumentos exactos.
        if (hilo) {
          const r = await fetch(`/api/operacion/operator?thread=${hilo}`, {
            cache: 'no-store',
          })
          if (r.ok) {
            const json = (await r.json()) as { acciones?: Accion[]; hilos?: ResumenHilo[] }
            setAcciones(json.acciones ?? [])
            // La misma respuesta trae la lista: así una conversación recién
            // empezada aparece en el historial sin pedir nada más.
            setHilos(json.hilos ?? [])
          }
        }
      } catch {
        setError(t('operation.operatorError'))
      } finally {
        setVivo(null)
        setPensando(false)
        setCorrida(null)
      }
    },
    [aLaMesa, fetchWithCsrf, pensando, retomar, t, thread],
  )

  enviarRef.current = enviar

  /**
   * Cambia el paso del hilo cuando su acción se decide.
   *
   * El hilo cuenta lo que pasó, y "pasó" incluye lo que decidiste después. Sin
   * esto, el paso se queda diciendo "esto haría" para siempre mientras abajo
   * aparece la misma cosa marcada como hecha: dos versiones del mismo hecho, y
   * la de arriba es la vieja.
   */
  const marcarPasoDecidido = useCallback((actionId: string, aprobado: boolean) => {
    setMensajes((ms) =>
      ms.map((m) =>
        m.bloques?.some((b) => b.k === 'paso' && b.actionId === actionId)
          ? {
              ...m,
              bloques: m.bloques.map((b) =>
                b.k === 'paso' && b.actionId === actionId
                  ? { ...b, estado: aprobado ? ('hecho' as const) : ('error' as const) }
                  : b,
              ),
            }
          : m,
      ),
    )
  }, [])

  /**
   * Traer al panel cómo quedó lo que se construyó.
   *
   * Se pide al servidor y no se reusa el artefacto del bloque a propósito: el
   * del bloque es lo que se PROPUSO, calculado desde los argumentos del modelo.
   * Entre proponer y guardar los nombres se convierten en ids y algún paso
   * puede no haber entrado — y ahí estaba escondida una automatización que en
   * el chat se veía bien y no podía funcionar.
   */
  const verComoQuedo = useCallback(
    async (actionId: string, key: string) => {
      try {
        const res = await fetch(`/api/operacion/operator/acciones/${actionId}/artefacto`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const json = (await res.json()) as {
          artefacto: Artefacto
          real: boolean
          entidadId: string | null
        }
        aLaMesa({
          tipo: 'fijar',
          fijado: {
            artefacto: json.artefacto,
            real: json.real,
            entidadId: json.entidadId,
            capabilityKey: key,
          },
        })
      } catch {
        /* si no se puede traer, no pasa nada: el paso sigue con su dibujo */
      }
    },
    [aLaMesa],
  )

  /**
   * Pedir un cambio antes de que se aplique nada.
   *
   * Trae la pieza al banco y deja el compositor listo. Es la salida que faltaba:
   * hasta ahora, frente a una propuesta que no era exactamente lo pedido, las
   * dos opciones eran aprobarla igual o descartarla y volver a explicar todo.
   */
  const pedirCambio = useCallback(
    (a: Accion) => {
      const nombre = a.preview?.match(/«([^»]+)»/)?.[1]
      setTexto(nombre ? `Cambia «${nombre}»: ` : t('operation.decisionPedirCambio'))
      const paso = mensajes
        .flatMap((m) => m.bloques ?? [])
        .find((b) => b.k === 'paso' && b.actionId === a.id)
      if (paso?.k === 'paso' && paso.artefacto) void verComoQuedo(a.id, a.capability_key)
    },
    [mensajes, t, verComoQuedo],
  )

  /**
   * Ofrecer prenderla, cuando lo aprobado dejó una automatización nueva.
   *
   * No la prende: pide la propuesta al servidor, que la deja con su vista
   * previa y sus dos botones como cualquier otra. Y si todavía no se puede
   * prender —le falta la plantilla, le falta la etiqueta— lo que vuelve es el
   * motivo escrito, que se muestra como una línea y no como un botón inerte.
   */
  const ofrecerPrender = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        try {
          const res = await fetchWithCsrf(
            `/api/operacion/operator/acciones/${id}/prender`,
            { method: 'POST' },
          )
          if (!res.ok) continue
          const json = (await res.json()) as {
            puede: boolean
            accion?: Accion
            motivo?: string | null
          }
          if (json.puede && json.accion) {
            setAcciones((a) => [...a, json.accion!])
          } else if (json.motivo) {
            setNotas((n) => [...n, json.motivo!])
          }
        } catch {
          /* si no se puede ofrecer, queda pausada y se prende desde su pantalla */
        }
      }
    },
    [fetchWithCsrf],
  )

  const decidir = useCallback(
    async (id: string, aprobar: boolean) => {
      setAcciones((a) =>
        a.map((x) =>
          x.id === id ? { ...x, status: aprobar ? 'ejecutado' : 'rechazado' } : x,
        ),
      )
      marcarPasoDecidido(id, aprobar)
      try {
        const res = await fetchWithCsrf(`/api/operacion/operator/acciones/${id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ aprobar }),
        })
        const json = (await res.json()) as { ok: boolean; status: string; message: string }
        setAcciones((a) =>
          a.map((x) =>
            x.id === id
              ? { ...x, status: (json.ok ? json.status : 'fallido') as Accion['status'] }
              : x,
          ),
        )
        if (!json.ok) marcarPasoDecidido(id, false)
        if (json.ok && aprobar) onChanged?.()
      } catch {
        setAcciones((a) =>
          a.map((x) => (x.id === id ? { ...x, status: 'fallido' } : x)),
        )
        marcarPasoDecidido(id, false)
      }
    },
    [fetchWithCsrf, marcarPasoDecidido, onChanged],
  )

  /**
   * La tarjeta entera, de una vez.
   *
   * Se resuelve completa —lo tildado se hace, lo destildado se descarta— y
   * recién cuando terminó todo se pregunta por lo que quedó dormido. Hacerlo
   * por acción suelta ofrecía prender antes de saber si la automatización
   * había llegado a crearse.
   */
  const resolver = useCallback(
    async (decisiones: { id: string; aprobar: boolean }[]) => {
      await Promise.all(decisiones.map((d) => decidir(d.id, d.aprobar)))
      const aprobadas = decisiones
        .filter((d) => d.aprobar)
        .map((d) => acciones.find((a) => a.id === d.id))
        .filter((a): a is Accion => Boolean(a))

      const creadas = aprobadas
        .filter((a) => CREAN_AUTOMATIZACION.includes(a.capability_key))
        .map((a) => a.id)
      if (creadas.length > 0) await ofrecerPrender(creadas)

      /**
       * Y el chat sigue.
       *
       * Al aprobar, el turno se terminaba ahí. Pero aprobar es justo lo que
       * desbloquea el resto: los tres mensajes existen, y ahora sí se puede
       * armar la automatización que los usa. Quedarse callado obliga a
       * escribir «seguí» a mano, y a que la persona se dé cuenta sola de que
       * hacía falta.
       *
       * No se sigue después de prender: ahí el trabajo terminó de verdad.
       */
      const soloPrender = aprobadas.every(
        (a) => a.capability_key === 'automatizaciones.activar',
      )
      if (aprobadas.length > 0 && !soloPrender) {
        /**
         * Y se dice QUÉ se aprobó.
         *
         * Decía «Listo, aprobado. Continúa.» y con eso el modelo no sabía qué
         * había quedado hecho: releía el pedido original y volvía a proponer el
         * mismo plan desde cero, así que aprobar tres plantillas terminaba con
         * las mismas tres plantillas propuestas otra vez.
         *
         * Con los nombres adentro, la vuelta siguiente arranca sabiendo de qué
         * ya no tiene que ocuparse.
         */
        const nombres = aprobadas
          .map((a) => String(a.args?.nombre ?? '').trim())
          .filter(Boolean)
        await enviarRef.current?.(
          nombres.length > 0
            ? t('operation.seguirCon', { que: nombres.join(', ') })
            : t('operation.seguir'),
        )
      }
    },
    [acciones, decidir, ofrecerPrender, t],
  )

  /**
   * Aprobar el reparto y dejar trabajar al equipo.
   *
   * Lo que corre son los pasos GUARDADOS: la ruta no le vuelve a preguntar al
   * modelo qué había que hacer, porque podría repartir distinto de lo que se
   * acaba de aprobar.
   */
  const correrPlan = useCallback(
    async (planId: string) => {
      setPlan((p) => (p ? { ...p, estado: 'corriendo' } : p))
      setPensando(true)
      setArrancoEn(Date.now())
      setVivo({ thinking: '', bloques: [] })
      try {
        const res = await fetchWithCsrf(
          `/api/operacion/operator/planes/${planId}/correr`,
          { method: 'POST' },
        )
        if (!res.ok || !res.body) throw new Error('failed')

        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buffer = ''
        let final = ''
        let bloques: Bloque[] = []

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += dec.decode(value, { stream: true })
          const { events, rest } = drainEvents(buffer)
          buffer = rest
          for (const e of events) {
            aLaMesa({ tipo: 'evento', e })
            if (e.t === 'text') final += e.delta
            if (e.t === 'error') setError(e.message)
            // Al correr un plan no hay `tool_start` antes de cada paso: el
            // reductor lo abre con la etiqueta que trae el evento, en vez de
            // imprimir la clave cruda de la capacidad.
            bloques = aplicarEventoDePlan(bloques, e)
          }
          setVivo({ thinking: '', bloques })
        }

        if (final.trim() || bloques.length > 0) {
          setMensajes((m) => [
            ...m,
            { id: `a-${m.length}`, role: 'assistant', text: final, bloques },
          ])
        }
        setVivo(null)
        setPlan((p) => (p ? { ...p, estado: 'listo' } : p))

        // Un plan aprobado CONSTRUYE lo inerte sin volver a preguntar, así que
        // acá no hay tarjeta de decisión que resolver — y es justo el camino
        // por el que se arman casi todas las automatizaciones. Sin esto, la
        // pregunta de si prenderla no aparecía nunca.
        await ofrecerPrender(
          bloques.flatMap((b) =>
            b.k === 'paso' && b.estado === 'hecho' && b.actionId &&
            CREAN_AUTOMATIZACION.includes(b.key)
              ? [b.actionId]
              : [],
          ),
        )

        // Las acciones que quedaron esperando salen del servidor: el stream
        // avisa que hay algo propuesto, no con qué argumentos exactos.
        const hilo = thread
        if (hilo) {
          const r = await fetch(`/api/operacion/operator?thread=${hilo}`, {
            cache: 'no-store',
          })
          if (r.ok) setAcciones(((await r.json()).acciones ?? []) as Accion[])
        }
      } catch {
        setError(t('operation.operatorError'))
        setPlan((p) => (p ? { ...p, estado: 'esperando' } : p))
      } finally {
        setVivo(null)
        setPensando(false)
      }
    },
    [aLaMesa, fetchWithCsrf, ofrecerPrender, t, thread],
  )

  /**
   * Todo lo que se vio pasar en el hilo, por su id de acción.
   *
   * Lo que está arriba, en el paso donde ocurrió, no se repite abajo: mostrar
   * dos veces la misma cosa —y la segunda truncada— era lo que hacía parecer
   * que el texto aparecía y se borraba. Ahora los bloques se guardan con el
   * mensaje, así que esto sigue valiendo después de recargar; antes se vaciaba
   * y TODAS las acciones del historial caían amontonadas al final.
   */
  const enElHilo = new Set(
    [...mensajes.map((m) => m.bloques ?? []), vivo?.bloques ?? []].flatMap((bs) =>
      bs.flatMap((b) => (b.k === 'paso' && b.actionId ? [b.actionId] : [])),
    ),
  )
  /**
   * Qué se está haciendo ahora mismo.
   *
   * El paso que está corriendo gana; si no hay ninguno, el especialista que
   * está trabajando; y si tampoco, que está pensando. Es lo que hace que la
   * espera se lea como trabajo en curso y no como una pantalla trabada.
   */
  const corriendo = [...(vivo?.bloques ?? [])]
    .reverse()
    .find((b): b is Extract<Bloque, { k: 'paso' }> => b.k === 'paso' && b.estado === 'corriendo')
  const trabajando = mesa.agentes.find((a) => a.estado === 'trabajando')
  /**
   * Qué está pasando, en tres palabras.
   *
   * Mostraba `trabajando.ultima`, que es el encargo entero escrito para el
   * especialista: «CREA LA AUTOMATIZACIÓN DE RECOMPRA DEL SERUM PILAR: AL
   * PAGARSE UN PEDIDO EN SHOPIFY…», cortado a la mitad. Nadie lee eso mientras
   * espera. Lo que hace falta saber es qué está tocando y si mira o construye.
   */
  const actividad = corriendo
    ? // Leer es «revisando las plantillas»; escribir tiene su propia frase por
      // dominio, porque «Armando las automatizaciones» y «Armando bandeja» no
      // son castellano.
      escribe(corriendo.key)
      ? t(`operation.haciendo${cap(dominioDe(corriendo.key))}`)
      : t('operation.vivoMirando', {
          que: enMinuscula(t(`operation.dom${cap(dominioDe(corriendo.key))}`)),
        })
    : trabajando
      ? trabajando.pidiendoA
        ? // «Le pide a Productos» hablaba en tercera persona de alguien que el
          // comercio no conoce. Lo que le importa es qué se está mirando.
          t('operation.consultando', {
            que: enMinuscula(t(`operation.dom${cap(dominioDe(trabajando.pidiendoA))}`)),
          })
        : t(`operation.haciendo${cap(dominioDe(trabajando.id))}`)
      : // Pensando, cuando de verdad está pensando.
        //
        // Mientras llega el razonamiento y todavía no se llamó a nadie, eso es
        // exactamente lo que pasa y no se decía nunca: la línea arrancaba en
        // «Leyendo tu cuenta» y saltaba directo al primer dominio.
        (vivo?.thinking ?? '').trim()
        ? t('operation.vivoPensando')
        : // Entre que un especialista termina y arranca el siguiente no hay
          // paso corriendo ni nadie trabajando, y la línea caía a una palabra
          // genérica —o parecía apagarse— justo en el hueco más largo. Se
          // queda lo último concreto que se dijo; al principio, cuando todavía
          // no hubo nada, se dice que está leyendo la cuenta.
          ultimaActividad.current || t('operation.vivoEmpezando')

  if (corriendo || trabajando) ultimaActividad.current = actividad

  /**
   * TODO lo que espera una decisión, junto y al final.
   *
   * Antes se partía en dos: lo que ocurrió en el turno de arriba se dibujaba
   * dentro de ese turno y el resto abajo, así que una conversación con dos
   * turnos mostraba dos tarjetas de decisión en lugares distintos. Es una sola
   * pregunta: qué de todo esto se hace.
   */
  const esperandoDecision = acciones.filter((a) => a.status === 'propuesto')
  const sueltas = acciones.filter((a) => !enElHilo.has(a.id))
  const resueltas = sueltas.filter((a) => a.status !== 'propuesto')

  return (
    <div
      className={cn(
        'flex h-full flex-col',
        // A pantalla completa el ancla es el taller, para que el historial se
        // cuelgue de la esquina de la PANTALLA y no de la de esta columna.
        !fullscreen && 'relative min-h-[26rem] rounded-xl border border-border bg-card',
      )}
    >
      {!fullscreen && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="size-4 text-accent-ink" />
          <h2 className="text-sm font-semibold text-foreground">
            {t('operation.operatorTitle')}
          </h2>
        </div>
      )}

      {/* En la esquina de la PANTALLA, no en la de la columna.
          Con el banco abierto la columna del chat son 430px, así que su borde
          derecho cae a la izquierda de todo y ahí nadie lo busca. El contenedor
          del taller es el que tiene `relative`, así que esto se cuelga de la
          esquina de arriba a la derecha de la pantalla entera. */}
      {fullscreen && (
        <div className="absolute top-3 right-4 z-30 flex items-center gap-3">
          <BotonHilos
            hilos={hilos}
            activo={thread}
            cargando={cargandoHilo}
            onAbrir={abrirHilo}
            onNuevo={nuevoChat}
            onBorrar={borrarChat}
          />
        </div>
      )}

      <div className={cn('flex-1 overflow-y-auto', !fullscreen && 'p-4')}>
        <div
          className={cn(
            'flex flex-col gap-3',
            // La conversación se apoya abajo, contra el compositor, en vez de
            // colgar del techo con media pantalla vacía debajo. Con el hilo
            // largo el scroll se comporta igual; con el hilo corto deja de
            // parecer una pantalla a medio cargar.
            // Sin `max-w-3xl` centrado: el pedido YA es una columna angosta,
            // y centrarlo adentro dejaba dos márgenes muertos a los costados.
            fullscreen &&
              'min-h-full w-full px-5 pt-16 pb-6 ' +
                (mensajes.length === 0 ? 'justify-center' : 'justify-end'),
          )}
        >
        {mensajes.length === 0 && (
          <div className={cn('space-y-4', fullscreen && 'pb-8 text-center')}>
            <p
              className={cn(
                'text-muted-foreground',
                fullscreen ? 'text-lg text-foreground' : 'text-sm',
              )}
            >
              {t('operation.operatorHint')}
            </p>
            <div className={cn('flex flex-wrap gap-2', fullscreen && 'justify-center')}>
              {['operatorTry1', 'operatorTry2', 'operatorTry3'].map((k) => (
                <button
                  key={k}
                  onClick={() => void enviar(t(`operation.${k}`))}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t(`operation.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m) =>
          m.bloques?.length ? (
            <Turno key={m.id} bloques={m.bloques} onVer={verComoQuedo} />
          ) : (
            <Dicho key={m.id} role={m.role} text={m.text} />
          ),
        )}

        {vivo && (
          <Turno bloques={vivo.bloques} thinking={vivo.thinking} onVer={verComoQuedo} />
        )}

        {plan && plan.estado !== 'rechazado' && (
          <TarjetaPlan
            plan={plan}
            onAprobar={() => correrPlan(plan.planId)}
            onRechazar={() => setPlan({ ...plan, estado: 'rechazado' })}
          />
        )}

        {/* Lo último de todo: se decide cuando ya se leyó el resto. */}
        {esperandoDecision.length > 0 && (
          <TarjetaDecision
            acciones={esperandoDecision}
            onResolver={resolver}
            onEditar={() => pedirCambio(esperandoDecision[0])}
          />
        )}

        {resueltas.map((a) => (
          <TarjetaResuelta key={a.id} accion={a} />
        ))}

        {notas.map((n, i) => (
          <p
            key={`${i}-${n.slice(0, 12)}`}
            className="border-l-2 border-amber-500/50 pl-3 text-xs leading-snug text-muted-foreground"
          >
            {n}
          </p>
        ))}

        {/* Abajo de todo, que es donde se mira mientras se espera. Y CALLADA
            mientras un plan espera aprobación: ahí no está pasando nada — el
            turno terminó y la pelota es de la persona. Decir «Armando las
            plantillas» encima de una tarjeta que pide un sí es contar algo que
            no está ocurriendo. */}
        {pensando && plan?.estado !== 'esperando' && (
          <EnVivo actividad={actividad} desde={arrancoEn} />
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
          <div ref={finalRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(texto)
        }}
        className={cn(
          'shrink-0',
          fullscreen ? 'w-full px-5 pb-5' : 'flex items-center gap-2 border-t border-border p-3',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2',
            // A pantalla completa el compositor es una pieza flotante y no una
            // franja pegada al borde: es lo que hace que el chat se sienta la
            // pantalla y no el pie de otra cosa.
            fullscreen && 'app-glass rounded-2xl px-4 py-3',
          )}
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t('operation.operatorPlaceholder')}
            className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {/* Mientras algo corre, el mismo botón detiene.
              Un turno tarda minutos y sigue aunque cierres la pestaña, así que
              detenerlo tiene que estar donde la mano ya está — y no escondido
              al lado de la línea que late. Es el mismo lugar donde uno espera
              encontrarlo. */}
          {pensando && corrida ? (
            <button
              type="button"
              onClick={() => {
                void fetchWithCsrf('/api/operacion/operator/corridas', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: corrida }),
                })
              }}
              aria-label={t('operation.detener')}
              title={t('operation.detener')}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground transition-colors hover:bg-foreground/20"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={pensando || !texto.trim()}
              aria-label={t('operation.operatorSend')}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>

        {/* Debajo del compositor y no en una pantalla de ajustes: es una
            decisión sobre lo que va a pasar en el próximo mensaje, así que se
            toma mirando el mensaje. */}
      </form>
    </div>
  )
}

/**
 * Las conversaciones anteriores, detrás de un botón.
 *
 * Antes era una tira horizontal arriba del hilo, y estaba mal por una razón
 * simple: ocupaba una franja de la pantalla todo el tiempo para algo que se usa
 * de vez en cuando, y con cinco conversaciones ya obligaba a desplazarse de
 * costado. Un botón en la esquina no le saca lugar a la conversación, que es lo
 * que se mira.
 *
 * Cada hilo es su propio contexto: lo que se habló en uno no entra en el otro.
 */
function BotonHilos({
  hilos,
  activo,
  cargando,
  onAbrir,
  onNuevo,
  onBorrar,
}: {
  hilos: ResumenHilo[]
  activo: string | null
  cargando: boolean
  onAbrir: (id: string) => void
  onNuevo: () => void
  onBorrar: (id: string) => void
}) {
  const t = useT()
  const fmt = useFormat()
  const [abierto, setAbierto] = useState(false)
  const pendientes = hilos.reduce((n, h) => n + (h.pendientes > 0 ? 1 : 0), 0)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      >
        <History className="size-3.5" />
        {t('operation.chatHistorial')}
        {/* Un punto y no un número: cuántas decisiones esperan se cuenta
            adentro; acá sólo hace falta saber que hay algo. */}
        {pendientes > 0 && (
          <span className="size-1.5 rounded-full bg-accent-ink" aria-hidden />
        )}
      </button>

      {abierto && (
        <>
          {/* El fondo cierra al tocar afuera, que es lo que espera cualquiera. */}
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setAbierto(false)}
            aria-label={t('operation.mesaCerrar')}
          />
          <div className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            <button
              type="button"
              onClick={() => {
                onNuevo()
                setAbierto(false)
              }}
              className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs text-foreground transition-colors hover:bg-muted/50"
            >
              <MessageSquarePlus className="size-3.5 text-accent-ink" />
              {t('operation.chatNuevo')}
            </button>

            {hilos.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">
                {t('operation.chatSinHistorial')}
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {hilos.map((h) => (
                  <li
                    key={h.id}
                    className={cn(
                      'group flex items-center gap-1 px-1.5 transition-colors hover:bg-muted/50',
                      h.id === activo && 'bg-primary/10',
                    )}
                  >
                    <button
                      type="button"
                      disabled={cargando}
                      onClick={() => {
                        onAbrir(h.id)
                        setAbierto(false)
                      }}
                      className="min-w-0 flex-1 px-1.5 py-2 text-left"
                    >
                      <span
                        className={cn(
                          'block truncate text-xs',
                          h.id === activo ? 'text-accent-ink' : 'text-foreground',
                        )}
                      >
                        {h.titulo}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {fmt.dateTime(h.actualizado, {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {h.pendientes > 0 && ` · ${t('operation.chatEsperando')}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onBorrar(h.id)}
                      aria-label={t('operation.chatBorrar')}
                      title={t('operation.chatBorrar')}
                      className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * El reparto, con su botón.
 *
 * Se aprueba UNA vez y de ahí el equipo trabaja. Antes cada escritura pedía su
 * click, y con equipo eso se volvía absurdo: pedir "armá recuperación de
 * carritos" y tener que aprobar tres tarjetas seguidas es peor que la versión
 * anterior, no mejor.
 *
 * Aprobar acá NO aprueba todo lo que el equipo pueda hacer: lo que le llega a
 * una persona, sale a Meta o mueve dinero sigue dejando su propia tarjeta con
 * su propio botón, adentro del plan aprobado y fuera de él.
 */
function TarjetaPlan({
  plan,
  onAprobar,
  onRechazar,
}: {
  plan: PlanPendiente
  onAprobar: () => void
  onRechazar: () => void
}) {
  const t = useT()
  const corriendo = plan.estado === 'corriendo'
  const listo = plan.estado === 'listo'

  return (
    <div className="rounded-xl border border-accent-ink/30 bg-primary/5 p-3.5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-accent-ink" />
        <p className="text-sm font-medium text-foreground">{t('operation.planTitulo')}</p>
      </div>
      {/* El porqué no se imprime: los pasos numerados y el "espera al 1" ya lo
          dicen, y una frase más arriba de una lista que se explica sola es
          justo el texto que sobra. */}

      <ol className="mt-3 space-y-1.5">
        {plan.pasos.map((p) => (
          <li key={p.i} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-semibold text-accent-ink">
              {p.i + 1}
            </span>
            <span className="min-w-0 flex-1 leading-snug">
              <span className="font-medium text-foreground">{p.agente}</span>{" "}
              {/* La primera frase, y cortada a dos líneas. El encargo completo
                  es la instrucción que recibe el especialista —lleva el detalle
                  que necesita para no adivinar— y no algo para leer entero acá:
                  dos párrafos por paso convertían la tarjeta en un muro. */}
              <span className="line-clamp-2 text-muted-foreground">{p.que || primeraFrase(p.encargo)}</span>
              {/* Ninguna anotación de espera: «(espera al 1, 2, 3)» debajo del
                  paso 4 de una lista numerada dice lo que la numeración ya
                  dice. */}
            </span>
          </li>
        ))}
      </ol>

      {!listo && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onAprobar}
            disabled={corriendo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {corriendo && <Loader2 className="size-3.5 animate-spin" />}
            {corriendo ? t('operation.planCorriendo') : t('operation.planAprobar')}
          </button>
          <button
            type="button"
            onClick={onRechazar}
            disabled={corriendo}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            {t('operation.reject')}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * El turno mientras pasa: qué está pensando, qué va tocando y qué va diciendo.
 *
 * El razonamiento va arriba y apagado —en gris, más chico— porque es contexto y
 * no la respuesta. Los pasos van en el medio, cada uno con su estado, y así se
 * ve que está trabajando y en qué. El texto aparece abajo, en la misma burbuja
 * en la que va a quedar cuando termine, para que no salte de lugar al cerrar.
 */
/**
 * Lo que está pasando ahora mismo.
 *
 * Vive todo el turno y no sólo antes del primer paso: la parte larga de una
 * corrida es justo la del medio, y ahí la pantalla se quedaba sin decir nada.
 *
 * La luz que recorre el texto reemplaza a tres barras que saltaban. Un cargador
 * de barras dice "esperá"; una línea que se ilumina mientras nombra lo que se
 * está haciendo dice "esto está pasando", que es otra cosa.
 */
function EnVivo({ actividad, desde }: { actividad: string; desde: number | null }) {
  const segundos = useSegundos(desde)
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <span className="app-punto size-1.5 shrink-0 rounded-full bg-accent-ink" aria-hidden />
      {/* En minúscula y sin el espaciado de etiqueta: es una frase que cambia
          sola cada pocos segundos, y en mayúsculas se lee como un registro de
          sistema en vez de como alguien contando qué está haciendo.

          `key` para que CADA frase entre: sin él React reusa el nodo, cambia el
          texto de golpe y la animación no vuelve a correr. */}
      <span
        key={actividad}
        className="app-latiendo app-entra min-w-0 truncate text-xs text-muted-foreground"
      >
        {actividad}
      </span>
      {/* El reloj: un turno del equipo tarda minutos y la frase puede quedarse
          igual un rato largo. Sin nada que se mueva, «Armando la automatización»
          quieto por dos minutos se lee como colgado. Aparece a los tres
          segundos para no titilar en los turnos cortos. */}
      {segundos >= 3 && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
          {segundos < 60 ? `${segundos}s` : `${Math.floor(segundos / 60)} min`}
        </span>
      )}
    </div>
  )
}

/** Los segundos que van desde que arrancó, contados de a uno. */
function useSegundos(desde: number | null): number {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    if (desde === null) return
    const reloj = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(reloj)
  }, [desde])
  // El piso en cero es por el primer render de cada turno: `ahora` todavía es
  // el del turno anterior y la resta da negativa. Cero es lo correcto ahí.
  return desde === null ? 0 : Math.max(0, Math.floor((ahora - desde) / 1000))
}

/**
 * Lo que se dijo, sin burbujas.
 *
 * Lo que pediste va con el resaltador de la marca —un marcador sobre el texto,
 * no una cápsula— y lo que contesta el equipo va como prosa. Las burbujas
 * enfrentadas son de una app de mensajería; esto es una transcripción, y leerla
 * como tal es lo que la separa de cualquier chat de IA.
 */
function Dicho({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  if (!text.trim()) return null
  if (role === 'user') {
    return (
      <p className="text-[15px] leading-relaxed font-medium">
        <span className="app-resaltado">{text}</span>
      </p>
    )
  }
  return (
    <div className="text-sm leading-relaxed text-foreground">
      <TextoRico text={text} />
    </div>
  )
}

function Turno({
  bloques,
  thinking,
  onVer,
}: {
  bloques: Bloque[]
  thinking?: string
  onVer?: (actionId: string, key: string) => void
}) {
  return (
    <div className="space-y-3">
      {thinking ? (
        <p className="line-clamp-3 border-l border-dashed border-border pl-3 text-[11px] leading-snug text-muted-foreground">
          {thinking}
        </p>
      ) : null}

      {/* Un paso NO deja fila. Sólo los que fallaron.
          Contaban que el equipo había mirado o escrito algo —«Las plantillas ✓»,
          «RECOMPRA_SERUM_1U ✓»— y ninguna de las dos cosas es una decisión ni un
          resultado que haga falta leer: lo que se armó está en el panel de la
          derecha y lo que hay que decidir, en la tarjeta de abajo. Mientras
          pasan, la línea viva dice qué está haciendo. Un error sí se queda: es
          lo único que nadie más va a contar. */}
      {agrupar(bloques).map(({ b, veces }) =>
        b.k === 'texto' ? (
          <Dicho key={b.id} role="assistant" text={b.texto} />
        ) : b.estado === 'error' ? (
          <Paso key={b.id} b={b} veces={veces} onVer={onVer} />
        ) : null,
      )}

      {/* Una sola decisión, al final, después de todo lo que el equipo dijo.
          Antes cada acción traía su propia tarjeta: un pedido de recompra
          terminó en OCHO tarjetas seguidas —tres borradores, tres envíos a
          Meta, la automatización, las ediciones— y una de ellas vaciaba las
          ramas de la automatización. Se veía igual que las otras siete. */}
      {/* La tarjeta NO se dibuja acá.
          Estaba al final del turno, que en una conversación con más de un turno
          queda en el medio — y encima el plan de trabajo aparecía debajo, así
          que había que decidir algo con texto todavía por leer. Lo que se
          decide va último de todo, y en un solo lugar. */}
    </div>
  )
}

/**
 * Un paso, como anotación al margen.
 *
 * Sin botón y sin verbo: dice QUÉ tocó —«Las plantillas»— y el icono dice cómo
 * salió. Cuando dejó un dibujo, la fila entera lo trae al banco; un botón
 * «Ver el detalle» debajo de cada paso era una tercera cosa que decidir en una
 * pantalla que ya tenía demasiadas.
 */
function Paso({
  b,
  veces,
  onVer,
}: {
  b: Extract<Bloque, { k: 'paso' }>
  veces: number
  onVer?: (actionId: string, key: string) => void
}) {
  const hecho = b.estado === 'hecho'
  const clicable = Boolean(b.artefacto && b.actionId && onVer)
  // Cuando la pieza tiene nombre, ése ES lo que tocó, y es más preciso que el
  // dominio. Sin esto, un turno que escribe tres plantillas deja tres filas que
  // dicen «Las plantillas» y no hay forma de saber cuál trae cuál.
  const nombre =
    b.artefacto && 'nombre' in b.artefacto && typeof b.artefacto.nombre === 'string'
      ? b.artefacto.nombre
      : ''

  const cuerpo = (
    <>
      {b.estado === 'corriendo' ? (
        <Loader2 className="size-3 shrink-0 animate-spin" />
      ) : b.estado === 'error' ? (
        <X className="size-3 shrink-0 text-red-600 dark:text-red-400" />
      ) : (
        <Check
          className={cn('size-3 shrink-0', hecho ? 'text-accent-ink' : 'opacity-60')}
        />
      )}
      <span className={cn('min-w-0 truncate', hecho && 'text-accent-ink')}>
        {nombre || b.label}
      </span>
      {veces > 1 && <span className="shrink-0 tabular-nums opacity-60">×{veces}</span>}
      {b.estado === 'error' && b.detalle && (
        <span className="min-w-0 flex-1 truncate normal-case tracking-normal text-red-600 dark:text-red-400">
          {b.detalle}
        </span>
      )}
    </>
  )

  const clase =
    'flex w-full items-center gap-2 border-l border-border pl-3 text-left text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase'

  if (!clicable) return <p className={clase}>{cuerpo}</p>
  return (
    <button
      type="button"
      onClick={() => onVer!(b.actionId!, b.key)}
      className={cn(clase, 'transition-colors hover:border-accent-ink hover:text-foreground')}
    >
      {cuerpo}
    </button>
  )
}

/**
 * Todo lo que espera tu decisión, junto y de una vez.
 *
 * Una acción por tarjeta era honesto y salía carísimo: ocho clicks seguidos
 * para un solo pedido, y en el octavo ya nadie lee. Acá se ve el conjunto
 * antes de decidir, que es lo que faltaba.
 *
 * Cada línea se destilda por separado, así que aprobar en bloque no es aprobar
 * a ciegas. **Lo irreversible entra apagado**: mandar una plantilla a Meta
 * quema el nombre para siempre aunque la rechacen, y se mandaron tres que la
 * automatización final no usa. Ahora hay que pedirlo a propósito.
 *
 * Aprobar resuelve la tarjeta entera: lo tildado se hace y lo destildado se
 * descarta. Dejar algo colgando sería que la misma tarjeta reapareciera al
 * recargar, que es de dónde venimos.
 */
/**
 * Cómo se llama esta decisión: por lo que va a dejar.
 *
 * «Esto dejaría hecho» es una frase de relleno sobre una lista que ya se lee.
 * Un título que dice «Crear las plantillas» contesta la pregunta antes de que
 * nadie baje la vista.
 */
/**
 * Lo que ya está escrito y se puede mirar antes de decir que sí.
 *
 * En singular y en plural, porque el título los cuenta: «así queda el mensaje»
 * y «así quedan los 3 mensajes» son la misma frase con el número adentro.
 */
const MUESTRA: Record<string, [uno: string, varios: string]> = {
  'plantillas.crear': ['operation.nomPlantilla', 'operation.nomPlantillas'],
  'automatizaciones.crear': ['operation.nomAuto', 'operation.nomAutos'],
  'automatizaciones.crear_desde_receta': ['operation.nomAuto', 'operation.nomAutos'],
  'automatizaciones.editar': ['operation.nomAuto', 'operation.nomAutos'],
  'automatizaciones.editar_espera': ['operation.nomAuto', 'operation.nomAutos'],
  'campanas.crear': ['operation.nomCampana', 'operation.nomCampanas'],
  'segmentos.crear': ['operation.nomSegmento', 'operation.nomSegmentos'],
  'agentes.crear_borrador': ['operation.nomAgente', 'operation.nomAgentes'],
  'comentarios.crear_regla': ['operation.nomRegla', 'operation.nomReglas'],
}

/** Lo que SALE de la cuenta. No hay nada que mirar: hay que decidir si va. */
const MANDA: Record<string, string> = {
  'plantillas.enviar_a_meta': 'operation.mandarAMeta',
  'mensajes.enviar': 'operation.mandarMensaje',
}

/**
 * El título es la pregunta, y dice que la cosa YA está.
 *
 * «Crear las plantillas» nombra el botón: quien lo lee no sabe que el mensaje
 * ya está escrito, que se puede leer entero a la derecha, ni que puede pedir un
 * cambio en vez de aprobar. «Así queda el mensaje. ¿Apruebas o cambiamos algo?»
 * dice las tres cosas en un renglón.
 *
 * Sin «lo/la»: el género cambia con cada cosa y la frase se puede escribir sin
 * el pronombre.
 */
function tituloDe(acciones: Accion[], t: ReturnType<typeof useT>): string {
  const uno = acciones.length === 1
  if (acciones.every((a) => MUESTRA[a.capability_key])) {
    const nombres = [...new Set(acciones.map((a) => MUESTRA[a.capability_key][uno ? 0 : 1]))]
    if (nombres.length === 1) {
      return t(uno ? 'operation.decisionAsi' : 'operation.decisionAsiVarias', {
        que: t(nombres[0], { n: acciones.length }),
      })
    }
  }
  // Lo que sale de la cuenta se nombra por lo que hace; y con cosas de distinta
  // clase ningún título sería cierto, así que el genérico dice la verdad.
  const manda = [...new Set(acciones.map((a) => MANDA[a.capability_key]).filter(Boolean))]
  return manda.length === 1 && acciones.every((a) => MANDA[a.capability_key])
    ? t(manda[0])
    : t('operation.decisionTitulo')
}

function TarjetaDecision({
  acciones,
  onResolver,
  onEditar,
}: {
  acciones: Accion[]
  onResolver: (decisiones: { id: string; aprobar: boolean }[]) => void
  onEditar?: () => void
}) {
  const t = useT()
  /**
   * Lo irreversible entra apagado — cuando hay más de una cosa que mirar.
   *
   * La regla existe para que algo que quema un nombre para siempre no se
   * apruebe de arrastre, escondido en una lista de ocho. Con UNA sola línea no
   * hay dónde esconderse: la tarjeta ES la pregunta, con su aviso al lado, y
   * hacerla destildar primero sería pedir dos clicks para una sola decisión que
   * la persona está mirando de frente. Es el caso de «¿la prendo?».
   */
  /**
   * Lo irreversible entra apagado sólo cuando se puede colar.
   *
   * La regla existe para que algo que quema un nombre para siempre no se
   * apruebe de arrastre, escondido entre cosas que sí se deshacen. Dos casos en
   * los que no aplica, y los dos son el camino normal:
   *
   *  - Una sola línea: la tarjeta ES la pregunta, con su aviso al lado. Hacerla
   *    destildar primero son dos clicks para un sí o un no.
   *  - Todo irreversible: pedir tres mensajes y que los tres nazcan apagados no
   *    protege de nada — no hay de qué distinguirlos— y convierte el camino
   *    normal en cuatro clicks.
   */
  const [fuera, setFuera] = useState<Set<string>>(() => {
    const arriesgadas = acciones.filter((a) => a.risk === 'irreversible')
    const mezcla = arriesgadas.length > 0 && arriesgadas.length < acciones.length
    return mezcla && acciones.length > 1
      ? new Set(arriesgadas.map((a) => a.id))
      : new Set<string>()
  })
  const elegidas = acciones.filter((a) => !fuera.has(a.id))

  /**
   * Cuando la tarjeta ES la pregunta, se pregunta.
   *
   * Al terminar de armar una automatización queda una sola cosa por decidir:
   * si se prende. Envolver eso en «Esto dejaría hecho» con su casilla y su
   * lista de un renglón es ceremonia sobre un sí o un no.
   */
  const soloPrender =
    acciones.length === 1 && acciones[0].capability_key === 'automatizaciones.activar'
      ? acciones[0]
      : null

  if (soloPrender) {
    return (
      <div className="rounded-xl border border-accent-ink/30 bg-primary/5 p-3.5">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="size-4 shrink-0 text-accent-ink" />
          {t('operation.prenderPregunta')}
        </p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          {soloPrender.preview ?? describir(soloPrender)}
        </p>
        <div className="mt-3.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onResolver([{ id: soloPrender.id, aprobar: true }])}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            {t('operation.prenderSi')}
          </button>
          <button
            type="button"
            onClick={() => onResolver([{ id: soloPrender.id, aprobar: false }])}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
          >
            {t('operation.prenderNo')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-accent-ink/30 bg-primary/5 p-3.5">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Sparkles className="size-4 shrink-0 text-accent-ink" />
        {tituloDe(acciones, t)}
      </p>

      <ul className="mt-3 space-y-2.5">
        {acciones.map((a) => {
          const dentro = !fuera.has(a.id)
          return (
            <li key={a.id} className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={dentro}
                onChange={() =>
                  setFuera((f) => {
                    const n = new Set(f)
                    if (dentro) n.add(a.id)
                    else n.delete(a.id)
                    return n
                  })
                }
                className="mt-0.5 size-3.5 shrink-0 accent-[var(--primary)]"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-xs leading-snug',
                    dentro ? 'text-foreground' : 'text-muted-foreground line-through',
                  )}
                >
                  {alGrano(a.preview ?? describir(a))}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      {/* El aviso, UNA vez. Repetido en cada renglón es el mismo cartel tres
          veces, y tres carteles iguales se leen como decoración. */}
      {acciones.some((a) => a.risk === 'irreversible') && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {t('operation.decisionAvisoMeta')}
        </p>
      )}

      <div className="mt-3.5 flex items-center gap-2">
        <button
          type="button"
          disabled={elegidas.length === 0}
          onClick={() =>
            onResolver(acciones.map((a) => ({ id: a.id, aprobar: !fuera.has(a.id) })))
          }
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {t('operation.approve')}
          {acciones.length > 1 && elegidas.length > 0 && ` (${elegidas.length})`}
        </button>
        {/* Uno solo, y no uno por renglón: pedir un ajuste es UNA cosa, y se
            escribe en el chat con lo que haya que cambiar. */}
        {onEditar && (
          <button
            type="button"
            onClick={onEditar}
            className="app-card-cta rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-accent-ink"
          >
            <Pencil className="size-3" />
            {t('operation.decisionEditar')}
          </button>
        )}
        <button
          type="button"
          onClick={() => onResolver(acciones.map((a) => ({ id: a.id, aprobar: false })))}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          {t('operation.decisionDescartar')}
        </button>
        {elegidas.length === 0 && (
          <span className="text-[11px] text-muted-foreground">
            {t('operation.decisionNadaElegido')}
          </span>
        )}
      </div>
    </div>
  )
}

function TarjetaResuelta({ accion }: { accion: Accion }) {
  const t = useT()
  const label =
    accion.status === 'ejecutado'
      ? t('operation.statusExecuted')
      : accion.status === 'rechazado'
        ? t('operation.statusRejected')
        : t('operation.statusFailed')
  const Icon = accion.status === 'ejecutado' ? Check : X
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {accion.preview ?? describir(accion)}
      </span>
      <span className="shrink-0">{label}</span>
    </div>
  )
}

/**
 * Cuando la capacidad no trajo vista previa.
 *
 * Esto imprimía `plantillas.enviar_a_meta — nombre: recompra_1`: la clave de la
 * capacidad y sus argumentos crudos, en medio de una conversación en español.
 * El nombre del dominio dice lo mismo que puede decirse con honestidad.
 */
function describir(a: Accion): string {
  const valores = Object.values(a.args)
    .filter((v) => typeof v === 'string' && v.length < 60)
    .join(' · ')
  return valores || a.capability_key.split('.')[0]
}
