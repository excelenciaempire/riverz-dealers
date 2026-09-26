import type { ChannelConnection } from '@/types';

/**
 * Direcciones de correo en cabeceras From/To/Cc.
 *
 * Un correo que mandó el comercio pertenece a la conversación del CLIENTE, que
 * es un destinatario. Antes se tomaba "lo que hay antes de la primera coma" del
 * To, y eso fallaba con `"Pérez, Ana" <ana@x.com>` (la coma es parte del
 * nombre) y con un correo que el comercio se copió a sí mismo primero. Zoho,
 * además, devuelve la lista con entidades HTML (`&lt;ana@x.com&gt;`).
 */

export interface Direccion {
  email: string;
  name: string;
}

const ENTIDADES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#34;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&amp;': '&',
};

function decodificar(texto: string): string {
  return texto.replace(/&(lt|gt|quot|apos|amp|#34|#39);/gi, (m) => ENTIDADES[m.toLowerCase()] ?? m);
}

/** Parte la lista por `,` o `;` que no estén dentro de comillas ni de `<…>`. */
function partir(texto: string): string[] {
  const partes: string[] = [];
  let actual = '';
  let comillas = false;
  let angulo = false;
  for (const c of texto) {
    if (c === '"') comillas = !comillas;
    else if (c === '<' && !comillas) angulo = true;
    else if (c === '>' && !comillas) angulo = false;
    if ((c === ',' || c === ';') && !comillas && !angulo) {
      partes.push(actual);
      actual = '';
      continue;
    }
    actual += c;
  }
  partes.push(actual);
  return partes;
}

/** Todas las direcciones de una cabecera, en orden y sin repetir. */
export function direccionesDeCorreo(raw: string | null | undefined): Direccion[] {
  if (!raw) return [];
  const out: Direccion[] = [];
  const vistas = new Set<string>();
  for (const parte of partir(decodificar(raw))) {
    const angulada = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(parte);
    const suelta = /[^\s<>"',;:]+@[^\s<>"',;]+/.exec(parte);
    const email = (angulada?.[1] ?? suelta?.[0] ?? '').replace(/^mailto:/i, '').toLowerCase();
    if (!email.includes('@') || vistas.has(email)) continue;
    vistas.add(email);
    const name = angulada
      ? parte.slice(0, angulada.index).trim().replace(/^"(.*)"$/, '$1').trim()
      : '';
    out.push({ email, name });
  }
  return out;
}

/** Las direcciones del propio buzón conectado. */
export function direccionesPropias(
  connection: Pick<ChannelConnection, 'config' | 'external_account_id'>,
): Set<string> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  return new Set(
    [cfg.email, connection.external_account_id]
      .map((v) => String(v ?? '').trim().toLowerCase())
      .filter((v) => v.includes('@')),
  );
}

/**
 * El cliente de un correo que mandó el comercio: el primer destinatario (To,
 * luego Cc) que no sea el propio buzón. Null si sólo se lo mandó a sí mismo.
 */
export function destinatarioCliente(
  listas: Array<string | null | undefined>,
  propias: Set<string>,
): Direccion | null {
  for (const lista of listas) {
    for (const d of direccionesDeCorreo(lista)) {
      if (!propias.has(d.email)) return d;
    }
  }
  return null;
}
