import { recortarSalida } from '@/lib/ai/salida';
import { stripPublicCommentUrls } from '@/lib/ai/url-integrity';
import type { DmDecision } from './dm-opportunity';

/**
 * Lo que se publica debajo de un comentario, sin nada de red ni de base.
 *
 * Vivía dentro de `realtime.ts`, que arrastra adaptadores y la base: probar la
 * respuesta pública, o simularla en "Probar como cliente", obligaba a cargar
 * todo el camino en vivo. `realtime.ts` la sigue exportando.
 */

/**
 * Oraciones completas de `texto` que entran en `tope` caracteres.
 *
 * `recortarSalida` sirve para un mensaje privado, donde llenar el presupuesto
 * importa: si la primera oración ocupa menos de la mitad del tope, corta por
 * palabra y pega un `…`. Bajo una foto eso se lee mal, y salió así en público
 * el 2026-08-29:
 *
 *   «…la zona de la papada, de abajo hacia… 💬 Te escribí por privado.»
 *
 * Acá se prefiere una oración corta y entera a una larga cortada. Devuelve ''
 * si no entra ni la primera.
 */
function oracionesQueEntran(texto: string, tope: number): string {
  // El punto sólo cierra una oración cuando lo sigue un espacio o el final.
  // Así `$39.990` permanece entero en vez de convertir `990...` en la
  // supuesta oración siguiente.
  const partes = texto.match(/.+?(?:[.!?]+(?:\s+|$)|$)/g) ?? [];
  let salida = '';
  for (const parte of partes) {
    const siguiente = salida + parte;
    if (siguiente.trimEnd().length > tope) break;
    salida = siguiente;
  }
  return salida.trim();
}

/**
 * ¿El comentario habla de pagar por fuera de la caja? Eso se atiende por
 * privado y lo mira una persona: el dato de una cuenta no se discute debajo de
 * una publicación. Incluye cómo se dice en Argentina (alias, CBU, CVU), no sólo
 * en Colombia.
 */
export function esPagoManualEnComentario(texto: string): boolean {
  return /\b(transferencia|transferir|comprobante|bancolombia|nequi|llave|bold|addi|alias|cbu|cvu)\b/i.test(
    texto
  );
}

/**
 * El texto que se publica EN el comentario.
 *
 * Con DM enviado: lo lee cualquiera que pase por el post, así que no repite el
 * mensaje privado —que lleva precios, códigos y datos del pedido— sino que
 * avisa de que la respuesta ya salió por privado. Corto: Meta corta los
 * comentarios largos y un párrafo bajo una foto se lee como spam.
 *
 * Sin DM (modo 'público' o el clasificador dijo que no hacía falta): la
 * respuesta ES esta, así que va entera —recortada a lo que se lee bajo una
 * foto— y sin prometer un privado que nadie va a recibir.
 */
export function publicReplyFrom(
  dmText: string,
  dmSent = true,
  decision?: Pick<DmDecision, 'reason'>
): string {
  // Un pedido, reclamo o dato que deba ir por privado no puede reutilizar la
  // primera frase del borrador: esa frase puede contener guía, importe u otro
  // dato del cliente. La respuesta pública sólo invita al DM.
  if (
    decision?.reason === 'pedido' ||
    decision?.reason === 'reclamo' ||
    decision?.reason === 'privado'
  ) {
    return dmSent
      ? 'Te escribí por privado para revisarlo contigo 💬'
      : 'Por favor, escríbenos por mensaje privado para revisarlo contigo 💬';
  }
  // Instagram y Facebook no convierten los enlaces de comentarios en enlaces
  // clicables. El vínculo real ya salió por DM; repetirlo acá sólo deja texto
  // inútil y además hacía que el recortador partiera el dominio por sus puntos.
  const clean = stripPublicCommentUrls(dmText);
  if (!dmSent) {
    if (!clean) return '';
    return recortarSalida(clean, 480);
  }
  const first = clean.split('\n')[0]?.trim() ?? '';
  const short = oracionesQueEntran(first, 120);
  return short
    ? `${short} 💬 Te escribí por privado.`
    : 'Te escribí por privado 💬';
}
