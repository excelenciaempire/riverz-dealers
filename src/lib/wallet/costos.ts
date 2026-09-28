/**
 * Lo que cuesta cada cosa DE VERDAD, por cuenta.
 *
 * La cuenta que paga a costo no puede ver una tabla de tarifas: la tarifa es un
 * precio de lista con margen adentro, y a ella se le prometió lo contrario.
 * Necesita ver el número que se le va a descontar, y ese número tiene dos
 * fuentes, en este orden:
 *
 * 1. **Lo que le salió a ella.** Se mide sobre su propio consumo: los tokens de
 *    sus respuestas, los minutos de sus llamadas. Es el único número que le
 *    sirve para proyectar, porque una tienda con conversaciones largas y otra
 *    que contesta en dos líneas no gastan lo mismo ni de cerca.
 * 2. **La tarifa de lista del proveedor**, mientras no tenga historia. Es una
 *    estimación y se dice que lo es: mostrar un promedio ajeno como si fuera
 *    suyo es peor que decir "todavía no lo sabemos".
 *
 * Cada concepto además dice **quién cobra**. Es la pregunta que sigue siempre
 * ("¿esto a quién se lo estoy pagando?") y contestarla de antemano es la
 * diferencia entre una factura y una caja negra.
 */
import { esConsumoCobrado, movimientosDelPeriodo, rangoDe, type MovimientoResumen } from './movimientos';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cómo se cobra cada cosa.
 *
 * `incluido` y `sin_cargo` existen para poder MOSTRARLOS. Un tablero que sólo
 * lista lo que descuenta deja al comercio adivinando qué más está corriendo con
 * nuestras llaves, y esa duda es peor que cualquier número.
 */
export type FormaDeCobro = 'por_uso' | 'incluido' | 'sin_cargo';

export interface CostoReal {
  concepto: string;
  nombreEs: string;
  nombreEn: string;
  /** Centavos por unidad. Cero en lo que no se cobra. */
  centavos: number;
  unidad: string;
  /** Quién cobra ese consumo. */
  proveedor: string;
  /** Si sale de lo que consumió ESTA cuenta, o es la tarifa de lista. */
  medido: boolean;
  cobro: FormaDeCobro;
  /** Dentro de qué otra línea viaja, cuando es `incluido`. */
  dentroDeEs?: string;
  dentroDeEn?: string;
}

/**
 * TODO lo que corre con las llaves de Riverz, se cobre o no.
 *
 * Lo que no se cobra está acá igual y dice por qué: o viaja adentro de otra
 * línea —la voz y la transcripción ya están en el minuto de llamada— o sale tan
 * poco que cobrarlo costaría más ruido que la plata que mueve. Esconderlo sería
 * dejar al comercio preguntándose qué más estamos usando en su nombre.
 */
const CATALOGO: Omit<CostoReal, 'medido'>[] = [
  {
    concepto: 'recarga_ajuste',
    nombreEs: 'Ajustes de recargas',
    nombreEn: 'Top-up adjustments',
    centavos: 0,
    unidad: 'ajuste',
    proveedor: 'Stripe',
    cobro: 'por_uso',
  },
  {
    concepto: 'llamada_ia',
    nombreEs: 'IA de llamadas',
    nombreEn: 'Call AI',
    centavos: 0,
    unidad: 'petición',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'comision_stripe',
    nombreEs: 'Comisión de Stripe',
    nombreEn: 'Stripe processing fee',
    centavos: 0,
    unidad: 'recarga',
    proveedor: 'Stripe',
    cobro: 'por_uso',
  },
  {
    // ~2,5 ¢ con el modelo por defecto desde 2026-09-17 (Sonnet con caché
    // de una hora); con Opus 5 y caché de cinco minutos eran 6,05 ¢ medidos
    // en producción (2026-08-30), y con Haiku 1,44. Es sólo la semilla: en
    // cuanto la cuenta tiene historia se le muestra SU costo medido.
    concepto: 'ia_respuesta',
    nombreEs: 'Respuestas de la IA',
    nombreEn: 'AI replies',
    centavos: 2.5,
    unidad: 'respuesta',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'ia_operador',
    nombreEs: 'Operador',
    nombreEn: 'Operator',
    centavos: 8,
    unidad: 'respuesta',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    // Telefonía + transcripción + modelo + voz, todo junto.
    concepto: 'llamada_voz',
    nombreEs: 'Llamadas',
    nombreEn: 'Calls',
    centavos: 0,
    unidad: 'minuto',
    proveedor: 'Telnyx + Deepgram',
    cobro: 'por_uso',
  },
  {
    // El número propio para llamadas. Telnyx le pone precio al comprarlo —varía
    // por país y tipo— y se cobra tal cual: el alta con el primer mes, y
    // después cada renovación mensual.
    concepto: 'numero_telefono',
    nombreEs: 'Número de teléfono propio',
    nombreEn: 'Dedicated phone number',
    centavos: 0,
    unidad: 'mes',
    proveedor: 'Telnyx',
    cobro: 'por_uso',
  },
  {
    concepto: 'entender_publicacion',
    nombreEs: 'Entender una publicación o un anuncio',
    nombreEn: 'Understanding a post or ad',
    centavos: 1.5,
    unidad: 'publicación',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    // Mismo camino y mismo modelo que una respuesta.
    concepto: 'ia_seguimiento',
    nombreEs: 'Seguimientos cuando el cliente se calla',
    nombreEn: 'Follow-ups when the customer goes quiet',
    centavos: 2.5,
    unidad: 'seguimiento',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'ia_resumen',
    nombreEs: 'Memoria de tus conversaciones',
    nombreEn: 'Conversation memory',
    centavos: 0.6,
    unidad: 'resumen',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    // Jev decide (escalar, intención, spam) por ~0,005 centavos; la línea del
    // aviso cuando SÍ se escala la escribe Haiku, y es lo que sube el promedio.
    concepto: 'ia_clasificacion',
    nombreEs: 'Entender qué te pidieron',
    nombreEn: 'Understanding what was asked',
    centavos: 0.02,
    unidad: 'consulta',
    proveedor: 'TypeSafe · Anthropic',
    cobro: 'por_uso',
  },
  {
    // La búsqueda web de Anthropic: 10 USD cada mil búsquedas.
    concepto: 'busqueda_web',
    nombreEs: 'Búsquedas en internet',
    nombreEn: 'Web searches',
    centavos: 1,
    unidad: 'búsqueda',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'voz_tts',
    nombreEs: 'La voz con la que habla el agente',
    nombreEn: "The agent's voice",
    centavos: 0,
    unidad: 'petición',
    proveedor: 'Fish Audio',
    cobro: 'por_uso',
  },
  {
    concepto: 'voz_stt',
    nombreEs: 'Entender lo que se dice en la llamada',
    nombreEn: 'Understanding what is said on the call',
    centavos: 0.78,
    unidad: 'minuto',
    proveedor: 'Deepgram',
    cobro: 'incluido',
    dentroDeEs: 'Llamadas',
    dentroDeEn: 'Calls',
  },
  {
    concepto: 'imagen_entrante',
    nombreEs: 'Mirar la foto que manda tu cliente',
    nombreEn: 'Looking at the photo your customer sends',
    centavos: 0,
    unidad: 'foto',
    proveedor: 'Anthropic',
    cobro: 'incluido',
    dentroDeEs: 'Respuestas de la IA',
    dentroDeEn: 'AI replies',
  },
  {
    // Se cobra desde 2026-08-30. Whisper sale ~0,04 USD la HORA en Groq, o sea
    // fracciones de centavo por audio: antes se dejaba gratis porque el piso
    // del libro era un centavo entero y cobrarlo habría sido cobrar catorce
    // veces el trabajo. Desde que el acumulador guarda milésimas (migración
    // 221) eso ya no pasa, y un consumo de un proveedor conectado no tiene por
    // qué pagarlo Riverz.
    concepto: 'transcripcion',
    nombreEs: 'Pasar audio a texto',
    nombreEn: 'Audio to text',
    centavos: 0.185,
    unidad: 'minuto',
    proveedor: 'Groq / OpenAI (Whisper)',
    cobro: 'por_uso',
  },
  {
    // Las siete pantallas donde una persona le pide algo a la IA: mejorar un
    // texto, escribir un borrador, probar el agente, leer una web, redactar
    // una plantilla, armar un plan. Frenaban sin saldo y no cobraban nada.
    concepto: 'ia_asistencia',
    nombreEs: 'Asistencia de la IA',
    nombreEn: 'AI assistance',
    centavos: 2,
    unidad: 'uso',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'investigacion',
    nombreEs: 'Análisis de comentarios',
    nombreEn: 'Comment analysis',
    centavos: 8,
    unidad: 'análisis',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'lectura_de_pagina',
    nombreEs: 'Leer una página web',
    nombreEn: 'Reading a web page',
    centavos: 0,
    unidad: 'página',
    proveedor: 'Firecrawl',
    cobro: 'por_uso',
  },
  {
    // Sólo si la consulta salió con la llave de Riverz: el comercio que conecta
    // su propio Apify en Integraciones le paga directo a Apify.
    concepto: 'perfil_externo',
    nombreEs: 'Consultar un perfil público',
    nombreEn: 'Looking up a public profile',
    centavos: 0,
    unidad: 'perfil',
    proveedor: 'Apify',
    cobro: 'por_uso',
  },
];

/** Measured merchant prices use actual wallet debits, not provider-only logs
 * or courtesy/test traffic. Charges below one cent remain audit-only until
 * the ledger actually deducts them. */
export function costoPorConcepto(filas: MovimientoResumen[]): Record<string, number> {
  const totals = new Map<string, { centavos: number; unidades: number }>();
  for (const f of filas.filter(esConsumoCobrado)) {
    const n = Number(f.cantidad ?? 0);
    if (!(n > 0)) continue;
    const total = totals.get(f.concepto) ?? { centavos: 0, unidades: 0 };
    total.centavos += -Number(f.centavos);
    total.unidades += n;
    totals.set(f.concepto, total);
  }
  return Object.fromEntries([...totals].map(([concepto, total]) => [concepto, total.centavos / total.unidades]));
}

/** El costo real de cada concepto, para esta cuenta. */
export async function costosReales(
  db: SupabaseClient,
  workspaceId: string,
  snapshot?: MovimientoResumen[],
): Promise<CostoReal[]> {
  const porConcepto = costoPorConcepto(snapshot ?? await movimientosDelPeriodo(db, workspaceId, rangoDe()));

  return CATALOGO.map((c) => {
    const medidoCentavos = porConcepto[c.concepto] ?? null;
    return {
      ...c,
      centavos: medidoCentavos ?? c.centavos,
      medido: medidoCentavos !== null,
    };
  });
}

/**
 * Los conceptos que la billetera sabe mostrar.
 *
 * Existe para el test que impide cobrar algo que el comercio no puede ver: la
 * pantalla lista `CATALOGO`, así que un concepto cobrado y ausente de acá es
 * plata descontada a ciegas.
 */
export const CONCEPTOS_DEL_CATALOGO: ReadonlySet<string> = new Set(
  CATALOGO.map((c) => c.concepto)
);
