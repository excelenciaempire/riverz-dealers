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
 * Soporta ventanas que CRUZAN MEDIANOCHE (22:00-02:00, turno noche): si el
 * fin es menor o igual que el inicio, la ventana sigue hasta el día
 * siguiente. Para que "lunes 22:00-02:00" cubra también las 00:30 del
 * martes, evaluamos el día actual y además el ANTERIOR.
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
    const today = dayMap[weekday];
    const yesterday = ((today + 6) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

    // Ventanas de HOY. Una que cruza medianoche (fin <= inicio) cuenta
    // desde el inicio hasta las 24:00 de hoy.
    const openToday = (hours.windows[today] ?? []).some((w) =>
      matches(w, nowMin, false),
    );
    if (openToday) return true;

    // Ventanas de AYER que siguen abiertas pasada la medianoche: "22:00-02:00"
    // del lunes tiene que cubrir la 01:00 del martes.
    return (hours.windows[yesterday] ?? []).some((w) => matches(w, nowMin, true));
  } catch {
    return true;
  }
}

/**
 * ¿`nowMin` (minutos desde medianoche de HOY) cae en la ventana `w`?
 *
 * `spillover` distingue los dos lados de una ventana nocturna:
 *   - false → estamos en el día en que ARRANCA (22:00-02:00 ⇒ 22:00–24:00)
 *   - true  → estamos en el día SIGUIENTE, y sólo cuenta la cola (⇒ 00:00–02:00)
 * Una ventana normal (09:00-18:00) nunca desborda, así que con `spillover`
 * no matchea nada.
 */
function matches(w: string, nowMin: number, spillover: boolean): boolean {
  const [from, to] = w.split('-');
  if (!from || !to) return false;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const fMin = (fh || 0) * 60 + (fm || 0);
  const tMin = (th || 0) * 60 + (tm || 0);
  const crossesMidnight = tMin <= fMin;
  if (spillover) return crossesMidnight && nowMin < tMin;
  return crossesMidnight ? nowMin >= fMin : nowMin >= fMin && nowMin < tMin;
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
