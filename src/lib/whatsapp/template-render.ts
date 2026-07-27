/**
 * Render del cuerpo de una plantilla de WhatsApp.
 *
 * Función pura y sin dependencias para que la usen por igual el servidor
 * (automatizaciones, cron de campañas) y el cliente (envío en vivo desde el
 * navegador). Vivía dentro de `lib/automations/meta-send`, que es server-only.
 *
 * Importa que TODOS los caminos guarden el texto renderizado: la IA lee
 * `messages.content_text` como contexto de la conversación, así que guardar
 * el nombre de la plantilla o el cuerpo con `{{1}}` sin sustituir le mete
 * ruido justo cuando el cliente responde a la campaña y la IA debe seguir
 * la charla como lo haría una persona.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const v = params[Number(n) - 1];
    return v != null && String(v).trim() ? String(v) : `{{${n}}}`;
  });
}
