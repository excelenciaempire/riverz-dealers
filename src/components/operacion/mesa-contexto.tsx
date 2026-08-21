'use client'

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type { Artefacto } from '@/lib/operator/artifacts'
import type { OperatorEvent } from '@/lib/operator/events'
import type { SubagentId } from '@/lib/operator/fleet/types'

/**
 * Lo que la mesa de trabajo sabe del equipo.
 *
 * Vive en un contexto y no en el estado del chat por una razón de layout: la
 * mesa es HERMANA del chat, no hija. La raíz del chat tiene su propio scroll y
 * su compositor, y meter el panel adentro obligaría a reestructurarla entera.
 * Con un contexto, el chat despacha desde el mismo `switch` donde ya lee el
 * stream, sin mover el lector, y la mesa se suscribe desde afuera.
 *
 * El reductor consume los eventos tal como llegan: no hay una segunda forma de
 * los datos que pueda quedar desincronizada de la primera.
 */

export interface AgenteEnMesa {
  id: SubagentId
  estado: 'trabajando' | 'listo' | 'fallido'
  /** Lo último que dijo. Una línea, no un párrafo. */
  ultima: string
  paso?: number
  propuestas: number
  construidas: number
}

export interface LienzoEnMesa {
  agente: SubagentId
  paso?: number
  artefacto: Artefacto
}

export interface PlanEnMesa {
  planId: string
  porque: string
  pasos: { i: number; agente: SubagentId; encargo: string; dependeDe: number[] }[]
  estado: 'propuesto' | 'corriendo' | 'terminado' | 'parcial' | 'fallido' | 'rechazado' | 'aprobado'
}

/**
 * Lo que alguien pidió mirar con el botón «Ver cómo quedó».
 *
 * `real` distingue lo leído de la base de lo que se había propuesto: entre una
 * cosa y la otra los nombres se convierten en ids y algún paso puede no haber
 * entrado, y esa diferencia es justo la que hay que poder ver.
 */
export interface FijadoEnMesa {
  artefacto: Artefacto
  real: boolean
  /** Para el enlace a la pantalla de siempre, cuando se puede. */
  entidadId: string | null
  capabilityKey: string
}

export interface EstadoMesa {
  agentes: AgenteEnMesa[]
  plan: PlanEnMesa | null
  lienzos: LienzoEnMesa[]
  fijado: FijadoEnMesa | null
  gasto: { promptTokens: number; completionTokens: number } | null
  /** Alguien del equipo está trabajando ahora mismo. */
  activo: boolean
}

const VACIA: EstadoMesa = {
  agentes: [],
  plan: null,
  lienzos: [],
  fijado: null,
  gasto: null,
  activo: false,
}

type Accion =
  | { tipo: 'evento'; e: OperatorEvent }
  | { tipo: 'fijar'; fijado: FijadoEnMesa | null }
  | { tipo: 'limpiar' }

function reducir(s: EstadoMesa, a: Accion): EstadoMesa {
  if (a.tipo === 'limpiar') return VACIA
  if (a.tipo === 'fijar') return { ...s, fijado: a.fijado }
  const e = a.e

  const conAgente = (id: SubagentId, patch: Partial<AgenteEnMesa>): EstadoMesa => {
    const i = s.agentes.findIndex((x) => x.id === id)
    // Se parchea en el lugar y no se mueve al final: en el panel, un agente que
    // salta de posición cada vez que dice algo es imposible de seguir con la
    // vista.
    const agentes =
      i >= 0
        ? s.agentes.map((x, n) => (n === i ? { ...x, ...patch } : x))
        : [
            ...s.agentes,
            {
              id,
              estado: 'trabajando' as const,
              ultima: '',
              propuestas: 0,
              construidas: 0,
              ...patch,
            },
          ]
    return { ...s, agentes }
  }

  switch (e.t) {
    case 'plan':
      return {
        ...s,
        plan: {
          planId: e.planId,
          porque: e.porque,
          pasos: e.pasos,
          estado: 'propuesto',
        },
      }

    case 'plan_estado':
      if (!s.plan || s.plan.planId !== e.planId) return s
      return {
        ...s,
        plan: { ...s.plan, estado: e.estado },
        activo: e.estado === 'corriendo',
      }

    case 'agente_inicio':
      return {
        ...conAgente(e.agente, {
          estado: 'trabajando',
          ultima: e.encargo,
          paso: e.paso,
        }),
        activo: true,
      }

    case 'agente_dice':
      return conAgente(e.agente, { ultima: e.texto })

    case 'agente_fin': {
      const next = conAgente(e.agente, {
        estado: e.ok ? 'listo' : 'fallido',
        ultima: e.resumen,
        propuestas: e.propuestas,
        construidas: e.construidas,
      })
      // Sigue activo mientras quede alguien trabajando: con tres en paralelo,
      // que termine uno no significa que terminó el equipo.
      const activo = next.agentes.some((x) => x.estado === 'trabajando')
      return { ...next, activo }
    }

    case 'agente_pide':
      return conAgente(e.agente, { ultima: `Le pide algo a ${e.a}` })

    case 'lienzo': {
      // Un lienzo por paso: cuando un subagente redibuja lo que está armando,
      // reemplaza al suyo en vez de acumular tres versiones del mismo árbol.
      const clave = (l: LienzoEnMesa) => `${l.agente}-${l.paso ?? 'x'}`
      const nuevo: LienzoEnMesa = { agente: e.agente, paso: e.paso, artefacto: e.artefacto }
      const i = s.lienzos.findIndex((l) => clave(l) === clave(nuevo))
      return {
        ...s,
        lienzos: i >= 0 ? s.lienzos.map((l, n) => (n === i ? nuevo : l)) : [...s.lienzos, nuevo],
      }
    }

    case 'gasto':
      return {
        ...s,
        gasto: { promptTokens: e.promptTokens, completionTokens: e.completionTokens },
      }

    case 'done':
      return { ...s, activo: false }

    default:
      return s
  }
}

const Estado = createContext<EstadoMesa>(VACIA)
const Despachar = createContext<(a: Accion) => void>(() => {})

export function MesaProvider({ children }: { children: ReactNode }) {
  const [estado, dispatch] = useReducer(reducir, VACIA)
  const valor = useMemo(() => estado, [estado])
  return (
    <Despachar.Provider value={dispatch}>
      <Estado.Provider value={valor}>{children}</Estado.Provider>
    </Despachar.Provider>
  )
}

export function useMesa(): EstadoMesa {
  return useContext(Estado)
}

export function useMesaDispatch() {
  return useContext(Despachar)
}

/**
 * ¿Vale la pena mostrar la mesa? Con nada adentro sólo ocupa lugar.
 *
 * Un plan que todavía nadie aprobó NO cuenta: no hay nadie trabajando, y el
 * plan ya está en el hilo con sus botones. Abrir el panel para repetirlo era
 * la misma frase dos veces en la misma pantalla.
 */
export function mesaTieneAlgo(m: EstadoMesa): boolean {
  return m.agentes.length > 0 || m.lienzos.length > 0 || m.fijado !== null
}
