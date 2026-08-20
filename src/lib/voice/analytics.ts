/**
 * Cómo vinieron las llamadas, en números.
 *
 * Esto vivía dentro de `GET /api/voice/analytics` y no se podía llamar desde
 * ningún otro lado. Cuando el chat pregunta "cómo vienen las llamadas" tiene
 * que contestar con LA misma tasa que muestra el panel: si "contestada" o
 * "confirmada" se calcularan dos veces, el mismo día daría dos cifras y
 * ninguna sería la cifra. La route ahora llama a esta función y devuelve
 * exactamente lo que devolvía antes.
 */
import type { VoiceCall } from '@/types';

/** Recorte por ciudad: sólo tiene sentido con `city` cargada por el pedido. */
export interface VoiceCityStat {
  city: string;
  total: number;
  confirmed: number;
}

export interface VoiceCallStats {
  total: number;
  answered: number;
  answered_pct: number;
  confirmed: number;
  confirmed_pct: number;
  minutes: number;
  cost: number;
  upsell_revenue: number;
  by_hour: { hour: number; count: number }[];
  by_city: VoiceCityStat[];
  by_outcome: { outcome: string; count: number }[];
}

/** Hora del día (0–23) de un ISO en una zona concreta, para que el corte por
 *  hora se lea en el reloj del comercio y no en el del servidor (UTC). */
function hourInTz(iso: string, tz: string): number {
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(
        new Date(iso),
      ),
    );
    return Number.isFinite(h) ? h % 24 : new Date(iso).getUTCHours();
  } catch {
    return new Date(iso).getUTCHours();
  }
}

/**
 * Agrega un conjunto de llamadas ya filtrado por quien llama.
 *
 * No filtra por dirección ni por fecha a propósito: quien la usa decide qué
 * llamadas cuentan (el panel mira sólo las salientes de un rango) y acá se
 * cuenta lo que llegó.
 *
 * "Confirmada" incluye `recovered`: en una llamada de carrito recuperado el
 * éxito no se llama confirmar, y separarlas daría dos tasas de éxito.
 */
export function summarizeVoiceCalls(
  calls: Partial<VoiceCall>[],
  tz: string,
): VoiceCallStats {
  const total = calls.length;
  const answered = calls.filter((c) => !!c.answered_at).length;
  const confirmed = calls.filter(
    (c) => c.outcome === 'confirmed' || c.outcome === 'recovered',
  ).length;
  const minutes = Math.round(
    calls.reduce((a, c) => a + (c.duration_seconds ?? 0), 0) / 60,
  );
  const upsellRevenue =
    Math.round(calls.reduce((a, c) => a + (Number(c.upsell_amount) || 0), 0) * 100) / 100;
  const cost =
    Math.round(calls.reduce((a, c) => a + (Number(c.cost?.total_usd) || 0), 0) * 100) / 100;

  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  const cityMap = new Map<string, { total: number; confirmed: number }>();
  const outcomeMap = new Map<string, number>();

  for (const c of calls) {
    const ts = c.started_at || c.created_at;
    if (ts) {
      const h = hourInTz(ts, tz);
      if (byHour[h]) byHour[h].count++;
    }
    const city = (c.city || '').trim();
    if (city) {
      const cur = cityMap.get(city) ?? { total: 0, confirmed: 0 };
      cur.total++;
      if (c.outcome === 'confirmed' || c.outcome === 'recovered') cur.confirmed++;
      cityMap.set(city, cur);
    }
    const oc = c.outcome || 'no_outcome';
    outcomeMap.set(oc, (outcomeMap.get(oc) ?? 0) + 1);
  }

  const byCity = [...cityMap.entries()]
    .map(([city, v]) => ({ city, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
  const byOutcome = [...outcomeMap.entries()]
    .map(([outcome, count]) => ({ outcome, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    answered,
    answered_pct: total ? Math.round((answered / total) * 100) : 0,
    // Sobre las CONTESTADAS y no sobre el total: a quien no atendió el teléfono
    // no se le pudo confirmar nada, y contarlo hundiría la tasa sin decir nada.
    confirmed,
    confirmed_pct: answered ? Math.round((confirmed / answered) * 100) : 0,
    minutes,
    cost,
    upsell_revenue: upsellRevenue,
    by_hour: byHour,
    by_city: byCity,
    by_outcome: byOutcome,
  };
}

/** Columnas mínimas que necesita `summarizeVoiceCalls`. */
export const VOICE_STATS_COLUMNS =
  'status, outcome, duration_seconds, upsell_amount, cost, city, answered_at, started_at, created_at';
