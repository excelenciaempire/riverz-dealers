/**
 * La puerta: ¿esta cuenta puede usar la IA ahora mismo?
 *
 * Una sola función para todos los lugares que gastan —bandeja, comentarios,
 * llamadas, Operador— porque la regla tiene que ser la misma en los cuatro. Con
 * la condición repetida en cuatro archivos, el día que cambie se va a cambiar
 * en tres.
 *
 * Son tres motivos distintos y se distinguen a propósito, porque lo que hay que
 * hacer es distinto: **sin saldo** se recarga y sigue; **suscripción vencida**
 * se paga o se pierde la cuenta; **sin pagar** es la cuenta que todavía no
 * pagó su link, y arranca cuando lo paga.
 *
 * Lo que NO apaga: la bandeja. El comercio sigue leyendo y contestando a mano
 * lo que haga falta. Cortarle el acceso a sus propias conversaciones porque nos
 * debe plata sería tomarle de rehén a sus clientes, que no deben nada.
 */
import { acceso, leerSuscripcion, usaSaldo } from '@/lib/billing/plan';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { pilotoConTecho, pilotoVivo } from '@/lib/piloto';
import { enPruebaSinPagar } from './prueba';
import { leerBilletera, puedeGastar, type Billetera } from './saldo';

export type Motivo = 'sin_saldo' | 'suscripcion_vencida' | 'sin_pagar' | null;

export interface Puerta {
  puede: boolean;
  motivo: Motivo;
  saldoCentavos: number;
}

/**
 * La cuenta que todavía no pagó su link (`cortesia` en la base) usa Riverz,
 * pero nada que le cueste a Riverz: ni IA ni lo demás que se cobra. Todo eso,
 * con la billetera, arranca cuando paga. No se le descuenta saldo: la
 * billetera tampoco está habilitada todavía.
 */
export async function puertaDeIa(
  db: SupabaseClient,
  workspaceId: string
): Promise<Puerta> {
  try {
    const [sus, billetera] = await Promise.all([
      leerSuscripcion(db, workspaceId),
      leerBilletera(db, workspaceId),
    ]);

    if (sus?.estado === 'cortesia') {
      // Probar antes de pagar sí se puede (`wallet/prueba`), y el piloto en vivo
      // también: con techo (números o límites) lo cubre Riverz, como la prueba.
      // Contestar en vivo sin piloto, no.
      const puede = enPruebaSinPagar() || pilotoConTecho(await pilotoVivo(db, workspaceId));
      return {
        puede,
        motivo: puede ? null : 'sin_pagar',
        saldoCentavos: billetera.saldoCentavos,
      };
    }

    if (sus && !acceso(sus).puede) {
      return {
        puede: false,
        motivo: 'suscripcion_vencida',
        saldoCentavos: billetera.saldoCentavos,
      };
    }

    if (!usaSaldo(sus)) {
      return {
        puede: true,
        motivo: null,
        saldoCentavos: billetera.saldoCentavos,
      };
    }

    if (!puedeGastar(billetera)) {
      return {
        puede: false,
        motivo: 'sin_saldo',
        saldoCentavos: billetera.saldoCentavos,
      };
    }

    return {
      puede: true,
      motivo: null,
      saldoCentavos: billetera.saldoCentavos,
    };
  } catch (e) {
    // No se autoriza un gasto externo sin poder comprobar el saldo.
    console.error('[wallet] no se pudo leer la puerta', e);
    return { puede: false, motivo: 'sin_saldo', saldoCentavos: 0 };
  }
}

/** Atajo booleano para los caminos que no necesitan el motivo. */
export async function puedeUsarIa(
  db: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  return (await puertaDeIa(db, workspaceId)).puede;
}

export type Aviso = 'gracia' | 'sin_saldo' | 'sin_pagar' | null;

/**
 * El saldo tal como se muestra de un vistazo, en cualquier pantalla.
 *
 * Es lo mínimo para pintar un número y decidir su color, sin arrastrar la
 * billetera entera al cliente: cuánto queda, si esta cuenta paga saldo y a
 * partir de cuánto conviene avisar. El umbral sale de acá y no del componente
 * porque es el MISMO que usa el aviso por WhatsApp: dos umbrales distintos
 * serían un cartel amarillo que no coincide con el mensaje que llega al
 * teléfono.
 */
export interface Vistazo {
  centavos: number;
  moneda: string;
  /** No gasta saldo y no se le muestra ninguno: no usa billetera o todavía no pagó. */
  exenta: boolean;
  /** Si llegar a cero apaga la IA. */
  bloquea: boolean;
  /** Por debajo de esto, el número se pinta como advertencia. */
  umbralCentavos: number;
  /** Con tarjeta y recarga automática no hace falta advertir: se repone solo. */
  autoConTarjeta: boolean;
}

/** El mismo piso que usa el aviso por WhatsApp cuando la cuenta no fijó el suyo. */
export const UMBRAL_VISTAZO_CENTAVOS = 500;

export interface EstadoDeCobro {
  /** La cuenta se cerró: pasaron las 48 horas y sigue sin pagar. */
  bloqueado: boolean;
  /** Qué cartel corresponde arriba de la pantalla. */
  aviso: Aviso;
  /** Horas que quedan de gracia, cuando el aviso es de gracia. */
  horas: number | null;
  saldoCentavos: number;
  /** El saldo para mostrarlo siempre a la vista, no sólo cuando duele. */
  vistazo: Vistazo;
}

function vistazoDe(b: Billetera, exenta: boolean): Vistazo {
  return {
    centavos: b.saldoCentavos,
    moneda: b.moneda,
    exenta,
    bloquea: b.bloquearSinSaldo && !exenta,
    umbralCentavos: b.autoUmbralCentavos ?? UMBRAL_VISTAZO_CENTAVOS,
    autoConTarjeta: b.tieneTarjeta && (b.autoRecargaCentavos ?? 0) > 0,
  };
}

const VISTAZO_VACIO: Vistazo = {
  centavos: 0,
  moneda: 'usd',
  exenta: true,
  bloquea: false,
  umbralCentavos: UMBRAL_VISTAZO_CENTAVOS,
  autoConTarjeta: false,
};

/**
 * Lo que la pantalla necesita saber, en una sola lectura.
 *
 * Son cuatro estados y sólo uno se muestra a la vez, en este orden: sin
 * pagar, cuenta cerrada, gracia corriendo, sin saldo. El orden importa —a
 * quien se le cerró la cuenta no le sirve enterarse de que además le falta
 * saldo— y por eso se decide acá y no en el componente, donde terminaría
 * siendo cuatro `if` sueltos que alguien reordena sin querer.
 *
 * La cuenta sin pagar no se cierra: sigue usando la app y se le avisa que la
 * IA arranca cuando pague.
 */
export async function estadoDeCobro(
  db: SupabaseClient,
  workspaceId: string
): Promise<EstadoDeCobro> {
  try {
    const [sus, billetera] = await Promise.all([
      leerSuscripcion(db, workspaceId),
      leerBilletera(db, workspaceId),
    ]);

    const exenta = sus?.estado === 'cortesia' || !usaSaldo(sus);
    const vistazo = vistazoDe(billetera, exenta);

    if (sus?.estado === 'cortesia') {
      return {
        bloqueado: false,
        aviso: 'sin_pagar',
        horas: null,
        saldoCentavos: billetera.saldoCentavos,
        vistazo,
      };
    }

    const a = acceso(sus);
    if (!a.puede) {
      return {
        bloqueado: true,
        aviso: null,
        horas: null,
        saldoCentavos: billetera.saldoCentavos,
        vistazo,
      };
    }
    if (a.estado === 'vencida' && a.horasDeGracia !== null) {
      return {
        bloqueado: false,
        aviso: 'gracia',
        horas: a.horasDeGracia,
        saldoCentavos: billetera.saldoCentavos,
        vistazo,
      };
    }
    if (!usaSaldo(sus)) {
      return {
        bloqueado: false,
        aviso: null,
        horas: null,
        saldoCentavos: billetera.saldoCentavos,
        vistazo,
      };
    }
    if (!puedeGastar(billetera)) {
      return {
        bloqueado: false,
        aviso: 'sin_saldo',
        horas: null,
        saldoCentavos: billetera.saldoCentavos,
        vistazo,
      };
    }
    return {
      bloqueado: false,
      aviso: null,
      horas: null,
      saldoCentavos: billetera.saldoCentavos,
      vistazo,
    };
  } catch (e) {
    // Un error de lectura no puede cerrarle la cuenta a nadie. Sin dato, el
    // vistazo se calla: un "US$0" inventado asusta peor que no mostrar nada.
    console.error('[wallet] no se pudo leer el estado de cobro', e);
    return {
      bloqueado: false,
      aviso: null,
      horas: null,
      saldoCentavos: 0,
      vistazo: VISTAZO_VACIO,
    };
  }
}

/**
 * La puerta, para lo que pide una persona con el dedo.
 *
 * Lo automático —la bandeja, los comentarios, las llamadas— se calla sin decir
 * nada: no hay nadie mirando y el cliente del comercio no tiene por qué
 * enterarse de que su proveedor se quedó sin saldo. Lo MANUAL es al revés: hay
 * alguien esperando una respuesta, y merece saber por qué no llega y qué hacer.
 *
 * Devuelve un 402 con el motivo, que es lo que la pantalla convierte en el
 * cartel con el botón de recargar. Null cuando puede seguir.
 */
export async function exigirSaldo(
  db: SupabaseClient,
  workspaceId: string
): Promise<NextResponse | null> {
  const puerta = await puertaDeIa(db, workspaceId);
  if (puerta.puede) return null;
  return NextResponse.json(
    {
      error: puerta.motivo ?? 'sin_saldo',
      saldoCentavos: puerta.saldoCentavos,
    },
    { status: 402 }
  );
}
