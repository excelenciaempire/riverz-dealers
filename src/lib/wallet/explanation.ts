import { esConsumoCobrado, type MovimientoResumen } from './movimientos';
import { movementTokens } from './movement-context';

export interface ChargeService {
  concepto: string;
  purpose: string | null;
  charges: number;
  chargedCentavos: number;
  tokens: number;
  seconds: number;
  firstAt: string;
  lastAt: string;
}
export interface ChargeSource {
  channel: string | null;
  charges: number;
  chargedCentavos: number;
  services: ChargeService[];
}
export interface ChargeExplanation {
  charges: number;
  chargedCentavos: number;
  sources: ChargeSource[];
}

/** Each debit belongs to exactly one source/service. Missing channel evidence
 * remains grouped by the actual billed service, never assigned by guesswork. */
export function explainCharges(rows: MovimientoResumen[]): ChargeExplanation {
  const sources = new Map<string, ChargeSource>();
  for (const row of rows.filter(esConsumoCobrado)) {
    const raw = row.detalle?.canal ?? row.detalle?.channel;
    const channel =
      typeof raw === 'string' && raw && raw !== 'unattributed' ? raw : null;
    const key = channel ?? `service:${row.concepto}`;
    const source = sources.get(key) ?? {
      channel,
      charges: 0,
      chargedCentavos: 0,
      services: [],
    };
    sources.set(key, source);
    const purpose =
      typeof row.detalle?.para === 'string' ? row.detalle.para : null;
    let service = source.services.find(
      (s) => s.concepto === row.concepto && s.purpose === purpose
    );
    if (!service) {
      service = {
        concepto: row.concepto,
        purpose,
        charges: 0,
        chargedCentavos: 0,
        tokens: 0,
        seconds: 0,
        firstAt: row.creado_en,
        lastAt: row.creado_en,
      };
      source.services.push(service);
    }
    const cents = -Number(row.centavos);
    source.charges++;
    source.chargedCentavos += cents;
    service.charges++;
    service.chargedCentavos += cents;
    service.tokens += movementTokens(row.detalle ?? undefined) ?? 0;
    const seconds = Number(row.detalle?.segundos ?? 0);
    if (Number.isFinite(seconds) && seconds > 0) service.seconds += seconds;
    if (Date.parse(row.creado_en) < Date.parse(service.firstAt))
      service.firstAt = row.creado_en;
    if (Date.parse(row.creado_en) > Date.parse(service.lastAt))
      service.lastAt = row.creado_en;
  }
  return {
    charges: [...sources.values()].reduce((n, s) => n + s.charges, 0),
    chargedCentavos: [...sources.values()].reduce(
      (n, s) => n + s.chargedCentavos,
      0
    ),
    sources: [...sources.values()].sort(
      (a, b) => b.chargedCentavos - a.chargedCentavos
    ),
  };
}
