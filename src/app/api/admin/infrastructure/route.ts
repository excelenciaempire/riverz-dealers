import { adminGet } from '@/lib/admin/route';
import {
  getInfrastructureStatus,
  type ServiceHealth,
} from '@/lib/admin/infrastructure';

/**
 * GET /api/admin/infrastructure — solo equipo Riverz.
 * Estado y saldo en vivo de todo lo conectado (LLMs, voz/telefonía, infra).
 */
export const dynamic = 'force-dynamic';

interface Status {
  services: ServiceHealth[];
  checkedAt: string;
}

/**
 * Caché compartida de las sondas.
 *
 * Cada consulta dispara ~11 llamadas externas, y entre ellas hay completions
 * FACTURABLES a Anthropic, OpenAI, Groq y Cerebras. La pantalla se refresca
 * sola cada 60 s, así que un par de pestañas abiertas toda la tarde eran
 * cientos de llamadas pagas para mirar el mismo número. El TTL queda apenas por
 * debajo de ese refresco: la pantalla sigue viéndose viva y varias pestañas
 * comparten una sola consulta real.
 */
const TTL_MS = 55_000;
let cached: { at: number; payload: Status } | null = null;
let inFlight: Promise<Status> | null = null;

async function statusCached(): Promise<Status> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.payload;
  // Single-flight: si dos pestañas piden a la vez, se sonda una sola vez.
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const payload = await getInfrastructureStatus();
        cached = { at: Date.now(), payload };
        return payload;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

export async function GET(request: Request) {
  return adminGet(request, { action: 'view.infrastructure' }, () =>
    statusCached(),
  );
}
