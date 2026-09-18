/**
 * ¿Este entrante lo escribió una persona o lo disparó el contestador del
 * cliente?
 *
 * Muchos clientes usan WhatsApp Business con mensaje de ausencia o de
 * bienvenida. Cuando les escribimos primero (una plantilla de pedido, un
 * seguimiento), lo que vuelve es "Gracias por comunicarte con X. Horarios de
 * atención: …" o "Gracias por comunicarte con X. ¿Cómo podemos ayudarte?". Meta
 * no lo marca como automático, así que llega igual que un mensaje real.
 *
 * Dos veces le contestó la IA a uno de esos como si fuera una persona: el
 * 2026-09-15 (y encima le recordó su compra) y el 2026-09-17 en Rasmiaw
 * ("¡Hola Sayra! Qué gusto verte de vuelta…" a una consultora contable).
 *
 * Es la ÚNICA implementación: la usa `inbox-writer` (para no despertar ni a
 * la IA ni a las automatizaciones) y el runner de IA (segunda barrera, por
 * los caminos que no pasan por el writer). Mismo criterio que
 * `detectAutomatedSender` para el correo: el mensaje se guarda y se ve en la
 * bandeja, pero nadie le contesta.
 *
 * Tres niveles de señal:
 *   - FUERTES: fórmulas que sólo escribe un contestador; valen solas.
 *   - SEÑALES: rasgos de contestador que una persona a veces también usa;
 *     hacen falta dos.
 *   - DEBILES: saludos de negocio ("¿en qué podemos ayudarte?"); sólo cuentan
 *     si llegaron a los minutos de un mensaje nuestro, porque solos no dicen
 *     nada (la gente contesta rápido y saluda).
 */

const FUERTES: RegExp[] = [
  /\b(?:este es un|es un|un)?\s*(?:mensaje|respuesta|contestaci[oó]n)\s+autom[aá]tic[oa]\b/i,
  /\bauto(?:matic)?(?:-|\s)?(?:reply|response|responder)\b/i,
  /\bgracias por (?:comunicarte|comunicarse|contactarnos|contactarte|escribirnos|escribir a|ponerte en contacto|ponerse en contacto)\b/i,
  /\bthank(?:s| you) for (?:contacting|reaching out|getting in touch)\b/i,
  /\bfuera de (?:nuestro |el )?horario\b/i,
  /\bout of (?:the )?office\b/i,
  /\ben (?:este momento|estos momentos) no (?:podemos|estamos|nos encontramos)\b/i,
  /\b(?:te|le|les) (?:responderemos|contestaremos|atenderemos|escribiremos) (?:a la brevedad|lo antes posible|en breve|tan pronto|pronto|en cuanto)\b/i,
  /\bnos (?:pondremos|comunicaremos) (?:en contacto )?(?:contigo|con usted|con vos)\b/i,
  /\bwe(?:'ll| will) (?:get back to you|reply|respond) (?:shortly|soon|as soon as)\b/i,
  /\bnuestro horario de atenci[oó]n\b/i,
];

const SEÑALES: RegExp[] = [
  /\bhorarios? de atenci[oó]n\b/i,
  /\b(?:quedamos|estamos) atentos? a (?:tu|su) mensaje\b/i,
  /\b(?:en breve|pronto|a la brevedad) (?:te|le) (?:responderemos|contestaremos|atenderemos)\b/i,
  /\bno (?:contestamos|atendemos|respondemos) llamadas\b/i,
  /\blunes a (?:viernes|s[aá]bado)\b[^\n]{0,40}\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?|hs|h)/i,
  /\bthanks for (?:contacting|reaching out|your message)\b.*\b(?:business hours|get back to you)\b/i,
  /\bgracias por (?:tu|su) mensaje\b/i,
];

const DEBILES: RegExp[] = [
  /\b(?:en qu[eé]|c[oó]mo) (?:podemos|te podemos|le podemos|puedo) ayudar(?:te|le|lo|la)?\b/i,
  /\bhow (?:can|may) (?:we|i) help(?: you)?\b/i,
  /\bbienvenid[oa]s? a\b/i,
  /\bgracias por (?:tu|su) mensaje\b/i,
];

/** Por debajo de esto no hay contestador: "Horarios de atención?" es una pregunta. */
const LARGO_MINIMO = 40;

/** Ventana en la que un saludo de negocio se considera reacción a lo nuestro. */
const VENTANA_MS = 10 * 60_000;

export interface SenalesDeEntrante {
  texto: string | null | undefined;
  /** Quién habló último en la conversación ANTES de este entrante. */
  ultimoRemitente?: string | null;
  /** Cuándo, ISO. */
  ultimoMensajeAt?: string | null;
  /** Cuándo llegó este entrante, ISO. Sin él no se evalúan los saludos débiles. */
  recibidoAt?: string | null;
}

export function esRespuestaAutomatica(s: SenalesDeEntrante | string | null | undefined): boolean {
  const señales: SenalesDeEntrante =
    typeof s === 'string' || s == null ? { texto: s ?? null } : s;
  const texto = (señales.texto ?? '').trim();
  if (texto.length < LARGO_MINIMO) return false;
  if (FUERTES.some((re) => re.test(texto))) return true;
  if (SEÑALES.filter((re) => re.test(texto)).length >= 2) return true;
  if (!DEBILES.some((re) => re.test(texto))) return false;

  const nuestro = señales.ultimoRemitente === 'agent' || señales.ultimoRemitente === 'bot';
  if (!nuestro || !señales.ultimoMensajeAt || !señales.recibidoAt) return false;
  const desde = Date.parse(señales.recibidoAt) - Date.parse(señales.ultimoMensajeAt);
  return Number.isFinite(desde) && desde >= 0 && desde <= VENTANA_MS;
}
