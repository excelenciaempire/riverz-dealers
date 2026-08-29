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
export async function enviarCorreo(
  to: string,
  titulo: string,
  cuerpo: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.WAITLIST_FROM || 'Riverz <onboarding@resend.dev>',
        to: [to],
        subject: titulo,
        html:
          `<div style="font-family:system-ui;max-width:520px">` +
          `<h2 style="margin:0 0 8px">${titulo}</h2>` +
          `<pre style="white-space:pre-wrap;font-family:system-ui;font-size:14px">${cuerpo}</pre>` +
          `</div>`,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
