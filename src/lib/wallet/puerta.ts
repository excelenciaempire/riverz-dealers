/**
 * La puerta: ¿esta cuenta puede usar la IA ahora mismo?
 *
 * Una sola función para todos los lugares que gastan —bandeja, comentarios,
 * llamadas, Operador— porque la regla tiene que ser la misma en los cuatro. Con
 * la condición repetida en cuatro archivos, el día que cambie se va a cambiar
 * en tres.
 *
 * Son dos motivos distintos y se distinguen a propósito, porque lo que hay que
 * hacer es distinto: **sin saldo** se recarga y sigue; **suscripción vencida**
 * se paga o se pierde la cuenta.
 *
 * Lo que NO apaga: la bandeja. El comercio sigue leyendo y contestando a mano
 * lo que haga falta. Cortarle el acceso a sus propias conversaciones porque nos
 * debe plata sería tomarle de rehén a sus clientes, que no deben nada.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { acceso, leerSuscripcion } from '@/lib/billing/plan'
import { puedeGastar, leerBilletera } from './saldo'

export type Motivo = 'sin_saldo' | 'suscripcion_vencida' | null

export interface Puerta {
  puede: boolean
  motivo: Motivo
  saldoCentavos: number
}

/**
 * La cuenta de **cortesía** nunca se apaga: es la que tiene el trato de que se
 * le instaló gratis. Cobrarle saldo a quien le prometimos que no paga sería
 * incumplir el trato con un `if`.
 */
export async function puertaDeIa(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Puerta> {
  try {
    const [sus, billetera] = await Promise.all([
      leerSuscripcion(db, workspaceId),
      leerBilletera(db, workspaceId),
    ])

    if (sus?.estado === 'cortesia') {
      return { puede: true, motivo: null, saldoCentavos: billetera.saldoCentavos }
    }

    if (sus && !acceso(sus).puede) {
      return {
        puede: false,
        motivo: 'suscripcion_vencida',
        saldoCentavos: billetera.saldoCentavos,
      }
    }

    if (!puedeGastar(billetera)) {
      return {
        puede: false,
        motivo: 'sin_saldo',
        saldoCentavos: billetera.saldoCentavos,
      }
    }

    return { puede: true, motivo: null, saldoCentavos: billetera.saldoCentavos }
  } catch (e) {
    // Ante un error nuestro, se atiende. Un fallo de lectura no puede dejar
    // mudo a un comercio que sí pagó.
    console.error('[wallet] no se pudo leer la puerta', e)
    return { puede: true, motivo: null, saldoCentavos: 0 }
  }
}

/** Atajo booleano para los caminos que no necesitan el motivo. */
export async function puedeUsarIa(
  db: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  return (await puertaDeIa(db, workspaceId)).puede
}

export type Aviso = 'gracia' | 'sin_saldo' | null

export interface EstadoDeCobro {
  /** La cuenta se cerró: pasaron las 48 horas y sigue sin pagar. */
  bloqueado: boolean
  /** Qué cartel corresponde arriba de la pantalla. */
  aviso: Aviso
  /** Horas que quedan de gracia, cuando el aviso es de gracia. */
  horas: number | null
  saldoCentavos: number
}

/**
 * Lo que la pantalla necesita saber, en una sola lectura.
 *
 * Son tres estados y sólo uno se muestra a la vez, en este orden: cuenta
 * cerrada, gracia corriendo, sin saldo. El orden importa —a quien se le cerró
 * la cuenta no le sirve enterarse de que además le falta saldo— y por eso se
 * decide acá y no en el componente, donde terminaría siendo tres `if` sueltos
 * que alguien reordena sin querer.
 */
export async function estadoDeCobro(
  db: SupabaseClient,
  workspaceId: string,
): Promise<EstadoDeCobro> {
  try {
    const [sus, billetera] = await Promise.all([
      leerSuscripcion(db, workspaceId),
      leerBilletera(db, workspaceId),
    ])

    if (sus?.estado === 'cortesia') {
      return {
        bloqueado: false,
        aviso: null,
        horas: null,
        saldoCentavos: billetera.saldoCentavos,
      }
    }

    const a = acceso(sus)
    if (!a.puede) {
      return {
        bloqueado: true,
        aviso: null,
        horas: null,
        saldoCentavos: billetera.saldoCentavos,
      }
    }
    if (a.estado === 'vencida' && a.horasDeGracia !== null) {
      return {
        bloqueado: false,
        aviso: 'gracia',
        horas: a.horasDeGracia,
        saldoCentavos: billetera.saldoCentavos,
      }
    }
    if (!puedeGastar(billetera)) {
      return {
        bloqueado: false,
        aviso: 'sin_saldo',
        horas: null,
        saldoCentavos: billetera.saldoCentavos,
      }
    }
    return {
      bloqueado: false,
      aviso: null,
      horas: null,
      saldoCentavos: billetera.saldoCentavos,
    }
  } catch (e) {
    // Un error de lectura no puede cerrarle la cuenta a nadie.
    console.error('[wallet] no se pudo leer el estado de cobro', e)
    return { bloqueado: false, aviso: null, horas: null, saldoCentavos: 0 }
  }
}
