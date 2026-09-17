/**
 * ¿Este entrante lo escribió una persona o lo disparó el contestador del
 * cliente?
 *
 * Un cliente que también es negocio (una consultora, una clínica) tiene su
 * propio WhatsApp Business con saludo automático: cada plantilla nuestra le
 * arranca un "Gracias por comunicarte con X. ¿Cómo podemos ayudarte?". Meta
 * no lo marca como automático, así que llega igual que un mensaje real y el
 * agente de IA le contestaba como a una persona ("¡Hola Sayra! Qué gusto
 * verte de vuelta…"), a nadie. Visto en Rasmiaw el 2026-09-17.
 *
 * Mismo criterio que `detectAutomatedSender` para el correo: el mensaje se
 * guarda y se ve en la bandeja, pero no despierta a la IA ni a las
 * automatizaciones.
 *
 * Dos señales, y con una fuerte alcanza:
 *   - El TEXTO es de contestador: fórmulas que un comprador no escribe.
 *   - El MOMENTO: llegó a los pocos minutos de un mensaje nuestro. Sola no
 *     dice nada (la gente contesta rápido); combinada con una fórmula débil
 *     ("¿en qué podemos ayudarte?") sí.
 */

/** Fórmulas que sólo escribe un contestador; valen sin mirar el reloj. */
const FUERTES: RegExp[] = [
  /\b(mensaje|respuesta|contestaci[oó]n)\s+autom[aá]tic[oa]\b/i,
  /\bauto(?:-|\s)?(?:reply|response|responder)\b/i,
  /\bgracias por (?:comunicarte|comunicarse|contactarnos|contactarte|escribirnos|escribir a|ponerte en contacto|ponerse en contacto)\b/i,
  /\bthank(?:s| you) for (?:contacting|reaching out|getting in touch|your message)\b/i,
  /\bfuera de (?:nuestro |el )?horario\b/i,
  /\bout of (?:the )?office\b/i,
  /\ben (?:este momento|estos momentos) no (?:podemos|estamos|nos encontramos)\b/i,
  /\b(?:te|le|les) (?:responderemos|contestaremos|atenderemos|escribiremos) (?:a la brevedad|lo antes posible|en breve|tan pronto|pronto|en cuanto)\b/i,
  /\bnos (?:pondremos|comunicaremos) (?:en contacto )?(?:contigo|con usted|con vos)\b/i,
  /\bwe(?:'ll| will) (?:get back to you|reply|respond) (?:shortly|soon|as soon as)\b/i,
  /\bnuestro horario de atenci[oó]n\b/i,
];

/** Fórmulas de saludo de negocio: sólo cuentan si llegan justo después de un mensaje nuestro. */
const DEBILES: RegExp[] = [
  /\b(?:en qu[eé]|c[oó]mo) (?:podemos|te podemos|le podemos|puedo) ayudar(?:te|le|lo|la)?\b/i,
  /\bhow (?:can|may) (?:we|i) help(?: you)?\b/i,
  /\bbienvenid[oa]s? a\b/i,
  /\bgracias por (?:tu|su) mensaje\b/i,
];

/** Ventana en la que un saludo de negocio se considera reacción a lo nuestro. */
const VENTANA_MS = 10 * 60_000;

export interface SenalesDeEntrante {
  texto: string | null | undefined;
  /** Quién habló último en la conversación ANTES de este entrante. */
  ultimoRemitente?: string | null;
  /** Cuándo, ISO. */
  ultimoMensajeAt?: string | null;
  /** Cuándo llegó este entrante, ISO. */
  recibidoAt: string;
}

export function esRespuestaAutomatica(s: SenalesDeEntrante): boolean {
  const texto = (s.texto ?? "").trim();
  if (!texto) return false;
  if (FUERTES.some((re) => re.test(texto))) return true;
  if (!DEBILES.some((re) => re.test(texto))) return false;

  const nuestro = s.ultimoRemitente === "agent" || s.ultimoRemitente === "bot";
  if (!nuestro || !s.ultimoMensajeAt) return false;
  const desde = Date.parse(s.recibidoAt) - Date.parse(s.ultimoMensajeAt);
  return Number.isFinite(desde) && desde >= 0 && desde <= VENTANA_MS;
}
