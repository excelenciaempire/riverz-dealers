import type { BusinessHours } from './types';

/**
 * ¿Estamos dentro del horario de atención configurado?
 *
 * Vivía como función privada del runner, así que el único camino que la
 * respetaba era la respuesta reactiva: los comentarios de Instagram y
 * Facebook mandaban DMs a las 3 AM aunque el negocio tuviera 9-18h. Al
 * extraerla, todos los caminos comparten la MISMA definición de horario.
 *
 * Sin horario configurado devuelve `true` (24/7), igual que ante un error
 * de parseo: preferimos responder de más a callarnos por un dato roto.
 *
 * Limitación conocida: no soporta ventanas que cruzan medianoche
 * (22:00-02:00). El editor bloquea inicio >= fin, así que ese estado no
 * se puede crear desde la UI.
 */
export function withinBusinessHours(
  hours: BusinessHours | null,
  at: Date = new Date(),
): boolean {
  if (!hours?.windows) return true;
  try {
    // We just match the wall-clock the formatter renders in the
    // configured tz — good enough for "9:00-18:00" type windows.
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone || 'America/Bogota',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const dayMap: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekday = fmt.find((p) => p.type === 'weekday')?.value ?? 'Mon';
    // Algunos locales/zonas rinden la medianoche como "24": normalizamos
    // para no calcular 1440 minutos y caer fuera de toda ventana.
    let hh = fmt.find((p) => p.type === 'hour')?.value ?? '00';
    if (hh === '24') hh = '00';
    const mm = fmt.find((p) => p.type === 'minute')?.value ?? '00';
    const nowMin = Number(hh) * 60 + Number(mm);
    const windows = hours.windows[dayMap[weekday]] ?? [];
    return windows.some((w) => {
      const [from, to] = w.split('-');
      if (!from || !to) return false;
      const [fh, fm] = from.split(':').map(Number);
      const [th, tm] = to.split(':').map(Number);
      const fMin = (fh || 0) * 60 + (fm || 0);
      const tMin = (th || 0) * 60 + (tm || 0);
      return nowMin >= fMin && nowMin < tMin;
    });
  } catch {
    return true;
  }
}

/**
 * ¿El texto del cliente pide explícitamente un humano?
 *
 * Misma lista `escalate_keywords` que usa el runner. Compartirla evita que
 * un comentario que dice "quiero hablar con una persona" reciba un DM de
 * venta automático.
 */
export function containsEscalationKeyword(
  keywords: string[] | null | undefined,
  text: string,
): boolean {
  const kws = keywords ?? [];
  if (!kws.length || !text) return false;
  const t = text.toLowerCase();
  return kws.some((k) => k && t.includes(k.toLowerCase()));
}
