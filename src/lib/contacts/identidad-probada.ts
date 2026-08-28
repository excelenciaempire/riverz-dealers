import type { Contact } from '@/types';

/**
 * Cuándo dos fichas son la MISMA persona, sin lugar a dudas.
 *
 * Unir de más no es un bug cosmético: le muestra a una persona la dirección, el
 * teléfono y los pedidos de otra. Unir de menos sólo hace que el agente
 * pregunte algo que ya sabía. No son igual de graves, así que la regla es una:
 * **ante la duda, no se une.**
 *
 * Módulo puro y aparte para poder probar la decisión sola, sin base.
 */

/**
 * De dónde salió un teléfono o un correo (migración 206).
 *
 * Los cinco primeros están RESPALDADOS: del otro lado hay algo que va a llegar
 * a algún lado, o alguien del comercio que lo escribió mirando. `afirmado` es
 * lo que un desconocido tipeó en un chat.
 */
export type OrigenDelDato =
  | 'canal' // el identificador ES la identidad del canal (WhatsApp, correo)
  | 'pedido' // un pedido con dirección de entrega
  | 'tienda' // el webhook o la ficha de cliente de la tienda
  | 'pago' // un cobro a nombre de esa persona
  | 'manual' // alguien del comercio lo cargó a mano
  | 'afirmado'; // lo escribió un anónimo en un chat

const RESPALDADOS = new Set<string>(['canal', 'pedido', 'tienda', 'pago', 'manual']);

/**
 * ¿Este origen habilita unir?
 *
 * `null` es lo anterior a la migración 206: no sabemos de dónde salió. Se trata
 * como heredado y se deja unir — esas uniones ya existen y romperlas de golpe
 * partiría en dos a clientes que hoy se ven bien.
 */
export function sirveParaUnir(origen: string | null | undefined): boolean {
  return origen == null || RESPALDADOS.has(origen);
}

/**
 * Casillas que son de un ROL, no de una persona.
 *
 * `info@`, `ventas@`, `noreply@`: la casilla del propio comercio o una que no
 * contesta nadie. Aparecen en la ficha de decenas de clientes distintos —un
 * formulario mal armado, un reenvío— y unir por ahí funde a todo el mundo en
 * una sola ficha. No hay vuelta atrás de eso.
 */
const CASILLAS_DE_ROL =
  /^(no-?reply|noreply|info|ventas|sales|contacto|contact|hola|hello|admin|soporte|support|ayuda|help|team|equipo|billing|facturacion|pedidos|orders|marketing|newsletter|postmaster|mailer-daemon|webmaster)@/i;

export function esCasillaDeRol(email: string): boolean {
  return CASILLAS_DE_ROL.test(email.trim());
}

/**
 * Teléfonos que no identifican a nadie.
 *
 * Todos los dígitos iguales, una escalera (1234…), o los rellenos que se
 * escriben para pasar un formulario obligatorio. Un comercio con veinte
 * pedidos de contra-entrega tiene varios `0000000000`, y unirlos los convierte
 * en un solo cliente con veinte direcciones distintas.
 */
export function esTelefonoDeRelleno(telefono: string): boolean {
  const d = telefono.replace(/\D/g, '');
  if (d.length < 8) return true;
  if (/^(\d)\1+$/.test(d)) return true;
  if ('01234567890123456789'.includes(d) || '09876543210987654321'.includes(d)) return true;
  return false;
}

/** Lo mínimo que hace falta saber de un candidato para decidir. */
export interface Candidato {
  id: string;
  phone?: string | null;
  email?: string | null;
}

const soloDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
const normal = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

/**
 * ¿Los candidatos se contradicen entre sí?
 *
 * El caso real: un teléfono de familia. Dos fichas comparten el celular y
 * tienen correos distintos — son dos personas, no una. Lo mismo al revés: un
 * correo compartido con dos teléfonos distintos.
 *
 * Un dato que está en una ficha y falta en la otra NO es contradicción: es
 * exactamente lo que la unión viene a completar.
 */
export function hayContradiccion(candidatos: Candidato[]): boolean {
  const correos = new Set(candidatos.map((c) => normal(c.email)).filter(Boolean));
  const telefonos = new Set(candidatos.map((c) => soloDigitos(c.phone)).filter(Boolean));
  return correos.size > 1 || telefonos.size > 1;
}

/**
 * Los identificadores por los que SÍ se puede buscar un duplicado.
 *
 * Devuelve sólo los que están respaldados y no son de relleno. Si no queda
 * ninguno, no se busca nada — que es lo mismo que no unir.
 */
export function identificadoresParaUnir(contacto: Contact): {
  phone: string | null;
  email: string | null;
} {
  const c = contacto as Contact & {
    phone_origen?: string | null;
    email_origen?: string | null;
    union_bloqueada?: boolean | null;
  };
  // Una separación hecha a mano gana sobre cualquier coincidencia: alguien ya
  // miró estas dos fichas y dijo que no son la misma persona.
  if (c.union_bloqueada) return { phone: null, email: null };

  const telefono = (c.phone ?? '').trim();
  const correo = (c.email ?? '').trim().toLowerCase();

  const phone =
    telefono && sirveParaUnir(c.phone_origen) && !esTelefonoDeRelleno(telefono)
      ? telefono
      : null;
  const email =
    correo &&
    correo.includes('@') &&
    sirveParaUnir(c.email_origen) &&
    !esCasillaDeRol(correo)
      ? correo
      : null;

  return { phone, email };
}
