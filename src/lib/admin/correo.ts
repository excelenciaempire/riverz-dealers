/**
 * Mandar un correo, sin ceremonia.
 *
 * Vivía adentro del cron de vigilancia y no lo podía usar nadie más — así que
 * el aviso de bienvenida, que es el que más falta hacía por correo, salía sólo
 * por WhatsApp. Es la misma función, movida a donde se la puede pedir.
 *
 * **Nunca lanza y nunca frena a quien lo llama.** Un correo que no sale es un
 * correo que no sale; no puede tumbar un webhook de pago ni una corrida de
 * cron. Devuelve si salió, para poder registrarlo.
 */
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function linkedBody(value:string) {
  return value.split(/(https:\/\/[^\s<>]+[\w/])/g).map(part=>
    part.startsWith('https://')?`<a href="${escapeHtml(part)}">${escapeHtml(part)}</a>`:escapeHtml(part)).join('');
}

export async function enviarCorreo(
  to: string,
  titulo: string,
  cuerpo: string,
  idempotencyKey?: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: JSON.stringify({
        from: process.env.WAITLIST_FROM || 'Riverz <onboarding@resend.dev>',
        to: [to],
        subject: titulo,
        text: cuerpo,
        html:
          `<div style="font-family:system-ui;max-width:520px">` +
          `<h2 style="margin:0 0 8px">${escapeHtml(titulo)}</h2>` +
          `<pre style="white-space:pre-wrap;font-family:system-ui;font-size:14px">${linkedBody(cuerpo)}</pre>` +
          `</div>`,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
