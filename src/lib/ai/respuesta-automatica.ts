/**
 * ¿Este mensaje lo escribió una persona o el contestador de su negocio?
 *
 * Muchos clientes usan WhatsApp Business con mensaje de ausencia. Cuando les
 * escribimos primero (una automatización de pedido, un seguimiento), lo que
 * vuelve es "Gracias por comunicarte con X. Horarios de atención: …". El
 * 2026-09-15 la IA le contestó a uno de esos como si fuera una consulta y,
 * encima, le recordó su compra: dos mensajes a un contestador que nadie leyó.
 *
 * Es una heurística de texto, deliberadamente conservadora: hacen falta DOS
 * señales de contestador (o una muy fuerte) para callarse. Un "gracias por
 * escribir" suelto de una persona real no alcanza.
 */
const SEÑALES: RegExp[] = [
  /\bgracias por (?:comunicarte|contactarte|contactarnos|comunicarse|escribirnos|escribir a)\b/i,
  /\bhorarios? de atenci[oó]n\b/i,
  /\b(?:quedamos|estamos) atentos? a (?:tu|su) mensaje\b/i,
  /\b(?:en breve|pronto|a la brevedad) (?:te|le) (?:responderemos|contestaremos|atenderemos)\b/i,
  /\b(?:este es un|mensaje) (?:mensaje )?autom[aá]tico\b/i,
  /\bno (?:contestamos|atendemos|respondemos) llamadas\b/i,
  /\blunes a (?:viernes|s[aá]bado)\b[^\n]{0,40}\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?|hs|h)/i,
  /\bfuera de (?:nuestro )?horario\b/i,
  /\bthanks for (?:contacting|reaching out|your message)\b.*\b(?:business hours|get back to you)\b/i,
];

/** Señales que solas ya lo dicen todo. */
const FUERTES: RegExp[] = [
  /\b(?:este es un|es un) mensaje autom[aá]tico\b/i,
  /\brespuesta autom[aá]tica\b/i,
  /\bauto(?:matic)?[- ]?reply\b/i,
];

export function esRespuestaAutomatica(texto: string | null | undefined): boolean {
  const t = (texto ?? '').trim();
  if (t.length < 40) return false;
  if (FUERTES.some((r) => r.test(t))) return true;
  let señales = 0;
  for (const r of SEÑALES) if (r.test(t)) señales++;
  return señales >= 2;
}
