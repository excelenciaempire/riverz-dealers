import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * El link para que otro pruebe el asistente sin entrar a Riverz.
 *
 * El caso es el dueño de la marca: quien arma la cuenta le manda un link y él
 * conversa como cliente desde el teléfono, sin usuario ni contraseña. El token
 * es `<workspace>.<vence>.<firma>`: una firma HMAC sobre `ENCRYPTION_KEY`, sin
 * fila que guardar, igual que el chat web. Vence solo; rotar la clave del
 * servidor invalida todos a la vez.
 *
 * Lo que abre es lo mismo que "Probar como cliente" y nada más: simular, sin
 * enviar nada a nadie. Con el link no se elige teléfono, así que tampoco se
 * pueden buscar pedidos reales de clientes.
 */

const DOMINIO = 'probar-compartido';
export const VIDA_DEL_LINK_MS = 30 * 24 * 60 * 60 * 1000;

function llave(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY not set — required to sign test links');
  return Buffer.from(k, 'hex');
}

function firma(cuerpo: string): string {
  return createHmac('sha256', llave())
    .update(`${DOMINIO}:${cuerpo}`)
    .digest('base64url')
    .slice(0, 32);
}

export function tokenDePrueba(workspaceId: string, ahora = Date.now()): string {
  const cuerpo = `${workspaceId}.${(ahora + VIDA_DEL_LINK_MS).toString(36)}`;
  return `${cuerpo}.${firma(cuerpo)}`;
}

/** La cuenta del link, o null si la firma no cierra o ya venció. */
export function verificarTokenDePrueba(token: unknown, ahora = Date.now()): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [workspaceId, vence, recibida] = partes;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return null;
  const esperada = Buffer.from(firma(`${workspaceId}.${vence}`));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return null;
  const hasta = parseInt(vence, 36);
  if (!Number.isFinite(hasta) || hasta < ahora) return null;
  return workspaceId;
}
