import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { linkUnifiedContact } from '@/lib/contacts/dedupe';

/**
 * El pedido dice quién es la persona. Recién ahí se la puede unir.
 *
 * El problema: Instagram, Messenger y Mercado Libre no dan teléfono ni correo
 * —Meta y ML anonimizan al comprador—, así que quien escribe por ahí es un id
 * opaco. Si mañana la misma persona escribe por WhatsApp, para Riverz son dos
 * desconocidos distintos: el agente le pregunta de nuevo lo que ya sabía y su
 * historial de compras queda partido en dos fichas.
 *
 * El pedido es el momento en que eso se puede arreglar. Alguien que da su
 * nombre, su teléfono y su dirección para recibir un paquete no está
 * *afirmando* quién es: se está comprometiendo. Es la misma vara con la que ya
 * une `attributeWebchatOrder` cuando llega una compra de la tienda.
 *
 * **Por qué acá sí y en `/api/widget/identify` no.** Ahí el dato es una
 * afirmación de un anónimo —escribió un correo en un chat y nadie lo verificó—,
 * y unir sobre eso es una toma de cuenta en dos pasos: poner el correo de otra
 * clienta y quedarse con su ficha y sus pedidos. Un pedido creado tiene del
 * otro lado una dirección a la que va a llegar algo, y un comercio que lo va a
 * mirar. La diferencia no es de formato del dato: es de qué lo respalda.
 *
 * Sólo COMPLETA lo que falta. Nunca pisa lo que el comercio corrigió a mano.
 *
 * Best-effort: el pedido ya está hecho en la tienda y no puede fallar porque
 * la ficha del contacto no se haya podido actualizar.
 */
export async function identificarPorElPedido(
  db: SupabaseClient,
  datos: {
    contactId: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  },
): Promise<void> {
  if (!datos.contactId) return;
  const nombre = (datos.name ?? '').trim();
  const telefono = (datos.phone ?? '').trim();
  const correo = (datos.email ?? '').trim().toLowerCase();
  if (!nombre && !telefono && !correo) return;

  try {
    const { data } = await db
      .from('contacts')
      .select('*')
      .eq('id', datos.contactId)
      .maybeSingle();
    const contacto = data as Contact | null;
    if (!contacto) return;

    const patch: Record<string, string> = {};
    if (nombre && !contacto.name) patch.name = nombre;
    // `pedido`: del otro lado hay una direccion a la que va a llegar algo.
    // Es lo que habilita unir esta ficha con la de otro canal.
    // Ocho dígitos es el piso de un teléfono real: por debajo es una extensión
    // o un número mal copiado, y unir por eso mezcla gente que no se conoce.
    if (telefono && telefono.replace(/\D/g, '').length >= 8 && !contacto.phone) {
      patch.phone = telefono;
      patch.phone_origen = 'pedido';
    }
    if (correo.includes('@') && !contacto.email) {
      patch.email = correo;
      patch.email_origen = 'pedido';
    }

    let enriquecido = contacto;
    if (Object.keys(patch).length > 0) {
      const { data: actualizado } = await db
        .from('contacts')
        .update(patch)
        .eq('id', contacto.id)
        .select('*')
        .single();
      if (actualizado) enriquecido = actualizado as Contact;
    }

    // Acá el desconocido de Instagram deja de serlo: si ese teléfono o ese
    // correo ya existían en otro canal, los dos contactos pasan a ser el mismo
    // cliente y el agente lee su historial completo desde la próxima pregunta.
    await linkUnifiedContact(db, enriquecido);
  } catch {
    /* El pedido ya existe en la tienda. Esto es de yapa. */
  }
}
