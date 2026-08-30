/**
 * EL INFORME DE ATRIBUCIÓN: qué ventas son de Riverz y cuáles sólo pasaron cerca.
 *
 * Todo esto vivía adentro del GET de `/api/analytics/attribution`, mil líneas
 * con el cálculo, las lentes y las ventanas metidos en el manejador. Eso
 * alcanzaba mientras la única forma de ver la cifra fuera abrir la pantalla.
 * El Operador tiene que poder contestar "¿cuánto vendió Riverz?" sin que nadie
 * abra un navegador, y una segunda implementación del cálculo sería una segunda
 * cifra — que en este número concreto es lo peor que puede pasar.
 *
 * La ruta se quedó con lo que es de una ruta: sesión, parámetros y el workspace.
 * Acá está el cálculo, y lo llaman los dos.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchRecentOrdersOtherPlatform } from '@/lib/commerce/recent-orders';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
import {
  fetchRecentOrders,
  getActiveShopifyConnection,
  normPhone,
} from '@/lib/attribution/shopify';
import { provenBy, type Proof } from '@/lib/attribution/prueba';
import {
  esVentaReal,
  ultimoToquePorLente,
  type SourceKind,
  type Toque,
} from '@/lib/attribution/lentes';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';

/**
 * GET /api/analytics/attribution?days=30
 *
 * Atribuye revenue de Shopify a las entidades del workspace en los últimos
 * `days` días, en cuatro lentes independientes:
 *
 *   - by_broadcast        — última campaña enviada al contacto 24h antes de la orden
 *   - by_flow             — último flow_run del contacto 24h antes de la orden
 *   - by_automation       — último automation_log (success/partial) 24h antes
 *   - by_agent            — última respuesta del asistente al contacto 24h antes
 *   - by_instagram_agent  — revenue ya atribuido por el Agente de IG a sus
 *                           destinatarios (determinista + incrementalidad),
 *                           dentro de la ventana de `days`.
 *
 * Son lentes SEPARADAS, no una partición: una misma orden puede contar para
 * varias (p. ej. el contacto recibió una campaña Y pasó por un flujo). Por eso
 * NO sumamos un total combinado — eso duplicaría órdenes.
 *
 * Output:
 *   { days, by_broadcast, by_flow, by_automation, by_instagram_agent }
 *   donde cada bucket es [{ id, name, orders_count, revenue, currency }]
 *
 * Limit por simplicidad: las lentes by_broadcast/by_flow/by_automation solo
 * cuentan órdenes con `email`/`phone` que matchea un contacto del workspace.
 */

interface AttrRow {
  id: string;
  name: string;
  orders_count: number;
  revenue: number;
  currency: string;
}

/** Totales de comercio (todas las órdenes del rango, no solo las atribuidas). */
interface CommerceTotals {
  revenue: { current: number; previous: number };
  orders: { current: number; previous: number };
  currency: string;
}

/**
 * Lo que pasó por Riverz, contado UNA vez y sólo si se puede probar.
 *
 * `attributed` cuenta los pedidos que traen una marca que puso Riverz —el link
 * de pago, el pedido creado por el asistente, el carrito del chat web, el
 * cupón personal—. Es la cifra que se muestra grande, y aguanta que la
 * discutan: no depende de creerle a una ventana de tiempo.
 *
 * `assisted` cuenta aparte los pedidos donde sólo hubo conversación antes de
 * la compra. Puede que Riverz haya ayudado; también puede que la venta la
 * trajera un anuncio de Meta y nosotros hayamos pasado por al lado. Se muestra
 * etiquetado como lo que es, nunca sumado a lo de arriba.
 *
 * Los dos dejan afuera al Agente de IG: ese lente no viene de estos pedidos
 * sino del revenue que su propio motor ya atribuyó por destinatario —con
 * cupón por persona y grupo de control—, sin id de pedido con qué deduplicar.
 */
interface Attributed {
  revenue: number;
  orders: number;
  currency: string;
}

/**
 * Un pedido atribuido, con lo que lo tocó y cuándo.
 *
 * La cifra de arriba es una suma, y una suma no se puede verificar. Esto es el
 * renglón por renglón que la sostiene: qué pedido, de quién, por cuánto, y qué
 * mensaje de Riverz llegó antes. Con esto el comercio abre su tienda, busca el
 * pedido por su número y comprueba que la plata que decimos existe.
 */
interface AttributedOrder {
  id: string;
  /** "#1042" cuando la tienda lo nombra; si no, el id interno. */
  reference: string;
  created_at: string;
  revenue: number;
  currency: string;
  /** Quién compró: nombre del contacto, o su correo/teléfono. */
  contact: string | null;
  contact_id: string | null;
  sources: Toque[];
  /**
   * `proven` = el pedido trae una marca de Riverz. `assisted` = sólo hubo
   * conversación antes. Lo que separa una cifra defendible de una inflada.
   */
  evidence: 'proven' | 'assisted';
  /** Qué lo prueba, cuando está probado. */
  proofs: Proof[];
  /** El hilo de la bandeja donde vive esta persona, para poder abrirlo. */
  conversation_id?: string | null;
  /**
   * La conversación de esta persona nació de un anuncio (Click-to-WhatsApp,
   * Instagram, Messenger). Se dice en la cara: el anuncio la trajo. Riverz a
   * lo sumo la atendió, y si además la cerró, eso ya lo dice `proofs`.
   */
  from_ad: boolean;
}

/**
 * Trae TODAS las filas de una consulta, no las primeras mil.
 *
 * PostgREST corta en 1000 filas y no avisa: `.limit(5000)` devuelve 1000 y el
 * código sigue como si eso fuera todo. Medido en este proyecto el 2026-08-28:
 * el workspace tenía 1893 conversaciones con contacto y la lectura devolvía
 * exactamente 1000, sin error. Lo que quedaba afuera eran justo las más
 * nuevas, que son las de la gente que compró esta semana.
 *
 * Se pide de a 1000 con `range` hasta que un tramo venga incompleto. Hace
 * falta un `order` estable en el llamador o dos tramos pueden traer la misma
 * fila. El tope existe para que un error de filtro no barra la tabla entera.
 */
async function traerTodo<T>(
  consulta: (
    desde: number,
    hasta: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tope = 50000,
): Promise<T[]> {
  const TRAMO = 1000;
  const filas: T[] = [];
  for (let desde = 0; desde < tope; desde += TRAMO) {
    const { data, error } = await consulta(desde, desde + TRAMO - 1);
    if (error) {
      console.error('[atribucion] no se pudo traer un tramo:', error);
      break;
    }
    const lote = data ?? [];
    filas.push(...lote);
    if (lote.length < TRAMO) break;
  }
  return filas;
}

/**
 * Cuántos pedidos viajan con su detalle.
 *
 * El total los cuenta todos; esta lista es para mirar. Mandar 3.000 renglones
 * a un panel que ya hace una consulta por pedido no ayuda a nadie, y nadie
 * audita a ojo más de un par de cientos. Van los más caros primero.
 */
const MAX_DETALLE = 200;

const EMPTY_TOTALS: CommerceTotals = {
  revenue: { current: 0, previous: 0 },
  orders: { current: 0, previous: 0 },
  currency: 'USD',
};

export function emptyResponse(days: number) {
  return {
    days,
    by_broadcast: [] as AttrRow[],
    by_flow: [] as AttrRow[],
    by_automation: [] as AttrRow[],
    by_agent: [] as AttrRow[],
    by_instagram_agent: [] as AttrRow[],
    totals: EMPTY_TOTALS,
    attributed: { revenue: 0, orders: 0, currency: 'USD' } as Attributed,
    assisted: { revenue: 0, orders: 0, currency: 'USD' } as Attributed,
    by_handler: { ia: { orders: 0, revenue: 0 }, humano: { orders: 0, revenue: 0 } },
    attributed_orders: [] as AttributedOrder[],
    attributed_orders_truncated: false,
  };
}


export interface OpcionesDeAtribucion {
  workspaceId: string;
  /** Comienzo del rango, ISO. */
  sinceIso: string;
  /** Fin del rango, ISO. */
  untilIso: string;
  /** Largo del rango en días, para la respuesta vacía. */
  days: number;
  /**
   * Ventana de last-touch en milisegundos: cuánto antes del pedido cuenta un
   * envío como el que lo causó.
   */
  lookbackMs: number;
  locale: Locale;
}

export async function leerAtribucion(
  admin: SupabaseClient,
  { workspaceId, sinceIso, untilIso, days, lookbackMs, locale }: OpcionesDeAtribucion,
) {
  // Conexión Shopify del workspace (token descifrado). null = sin conexión
  // activa o token indescifrable → la UI muestra el estado "Conectar Shopify".
  const conn = await getActiveShopifyConnection(admin, workspaceId);
  // Sin Shopify, el comercio puede tener Tiendanube o WooCommerce. Antes esta
  // pantalla contestaba "conectá Shopify" a alguien que SÍ tenía su tienda
  // conectada, y sus ventas no aparecían en ninguna métrica.
  const otraTienda = conn
    ? null
    : await fetchRecentOrdersOtherPlatform(admin, workspaceId, sinceIso).catch(
        () => null,
      );
  if (!conn && !otraTienda) {
    return { ...emptyResponse(days), not_connected: true };
  }

  // Órdenes recientes desde Shopify (fetch desde `since`), recortadas a la
  // ventana [since, until) — `until` solo limita en rangos personalizados/pasados.
  const sinceMs = Date.parse(sinceIso);
  const untilMs = Date.parse(untilIso);
  // Ventana previa de igual duración, para los deltas de los totales de comercio.
  const prevSinceIso = new Date(sinceMs - (untilMs - sinceMs)).toISOString();
  const prevSinceMs = Date.parse(prevSinceIso);
  let orders;
  let prevOrders;
  try {
    // Un solo fetch desde el inicio de la ventana previa; luego separamos en
    // actual [since,until) y previa [prevSince,since).
    const crudas = conn
      ? await fetchRecentOrders(conn, prevSinceIso)
      : ((
          await fetchRecentOrdersOtherPlatform(admin, workspaceId, prevSinceIso)
        )?.orders ?? []);
    // Un pedido cancelado o devuelto existe, pero no es plata.
    const all = crudas.filter(esVentaReal);
    orders = all.filter((o) => {
      const t = Date.parse(o.created_at);
      return t >= sinceMs && t < untilMs;
    });
    prevOrders = all.filter((o) => {
      const t = Date.parse(o.created_at);
      return t >= prevSinceMs && t < sinceMs;
    });
  } catch {
    return {
      ...emptyResponse(days),
      error: 'shopify_fetch_failed',
    };
  }

  // Totales de comercio: TODAS las órdenes del rango (no solo las atribuidas),
  // con su periodo previo para el delta. AOV se calcula en el cliente.
  const sumRevenue = (arr: typeof orders) =>
    Math.round(arr.reduce((s, o) => s + Number(o.total_price ?? '0'), 0) * 100) / 100;
  // La moneda sale de la tienda, no del primer pedido que aparezca.
  //
  // Con `orders[0]?.currency` un rango sin ventas —un lunes a la mañana, o el
  // día que Shopify tarda— caía en el default 'USD' y el panel de un comercio
  // argentino mostraba "0 US$". Un cero en la moneda equivocada se lee como un
  // dato, y es peor que no mostrar nada. `monedaDeLaTienda` la lee de la
  // conexión y sólo cae al pedido si ahí no hay nada.
  const moneda = await resolveWorkspaceCurrency(admin, workspaceId);
  const totals: CommerceTotals = {
    revenue: { current: sumRevenue(orders), previous: sumRevenue(prevOrders) },
    orders: { current: orders.length, previous: prevOrders.length },
    currency: orders[0]?.currency || prevOrders[0]?.currency || moneda,
  };

  // Agente de IG: revenue ya persistido por su motor (no depende del fetch de
  // arriba, pero solo lo mostramos en el camino feliz para no contradecir el
  // estado "conectado").
  const by_instagram_agent = await attributeInstagramAgent(
    admin,
    workspaceId,
    sinceIso,
    untilIso,
    locale,
  );

  // Match cada orden con un contact (por email o phone).
  const emails = Array.from(
    new Set(orders.map((o) => o.email).filter((x): x is string => !!x)),
  );
  const phones = Array.from(
    new Set(orders.map((o) => normPhone(o.phone)).filter((x): x is string => !!x)),
  );
  const { data: contactsByEmail } = await admin
    .from('contacts')
    .select('id, name, email, phone')
    .eq('workspace_id', workspaceId)
    .in('email', emails.length > 0 ? emails : ['__none__']);
  const { data: contactsByPhone } = await admin
    .from('contacts')
    .select('id, name, email, phone')
    .eq('workspace_id', workspaceId)
    .in('phone', phones.length > 0 ? phones : ['__none__']);

  // Cómo se llama cada contacto, para el detalle. Sin esto el renglón dice un
  // uuid, que no le sirve a nadie para reconocer al comprador.
  const nombreDeContacto = new Map<string, string>();
  const emailToContact = new Map<string, string>();
  for (const c of contactsByEmail ?? []) {
    const row = c as { id: string; name?: string | null; email?: string };
    if (row.email) emailToContact.set(row.email.toLowerCase(), row.id);
    const etiqueta = row.name?.trim() || row.email || '';
    if (etiqueta) nombreDeContacto.set(row.id, etiqueta);
  }
  const phoneToContact = new Map<string, string>();
  for (const c of contactsByPhone ?? []) {
    const row = c as { id: string; name?: string | null; phone?: string };
    if (row.phone) phoneToContact.set(normPhone(row.phone) ?? '', row.id);
    const etiqueta = row.name?.trim() || row.phone || '';
    if (etiqueta && !nombreDeContacto.has(row.id)) nombreDeContacto.set(row.id, etiqueta);
  }

  // Por cada orden buscamos su contacto y atribuimos a la última campaña,
  // flujo y automatización que lo tocaron en las 24h previas (last-touch).
  const byBroadcast = new Map<string, AttrRow>();
  const byFlow = new Map<string, AttrRow>();
  const byAutomation = new Map<string, AttrRow>();
  const byAgent = new Map<string, AttrRow>();
  const attributed: Attributed = { revenue: 0, orders: 0, currency: totals.currency };
  const assisted: Attributed = { revenue: 0, orders: 0, currency: totals.currency };
  const detalle: AttributedOrder[] = [];

  /**
   * Las conversaciones de cada contacto, para la lente del asistente, y de
   * cuáles nació de un anuncio.
   *
   * `ai_replies` guarda `conversation_id` y no `contact_id`, así que sin este
   * mapa habría que hacer un join por pedido dentro del bucle — y el bucle ya
   * hace tres consultas por pedido. Se trae una vez y se cruza en memoria.
   *
   * `ad_referral` lo sella el webhook cuando alguien escribe desde un anuncio
   * (Click-to-WhatsApp, Instagram, Messenger). Con eso el detalle puede decir
   * "a esta persona la trajo el anuncio" en vez de dejar que la cifra sugiera
   * que la trajimos nosotros.
   */
  const convDeContacto = new Map<string, string[]>();
  const contactosDeAnuncio = new Set<string>();
  {
    const convs = await traerTodo<{
      id: string;
      contact_id: string;
      ad_referral: unknown;
    }>((desde, hasta) =>
      admin
        .from('conversations')
        .select('id, contact_id, ad_referral')
        .eq('workspace_id', workspaceId)
        .not('contact_id', 'is', null)
        .order('id')
        .range(desde, hasta),
    );
    for (const c of convs) {
      const lista = convDeContacto.get(c.contact_id) ?? [];
      lista.push(c.id);
      convDeContacto.set(c.contact_id, lista);
      if (c.ad_referral) contactosDeAnuncio.add(c.contact_id);
    }
  }

  /**
   * La fila espejo de cada pedido, para las tiendas que no son Shopify.
   *
   * En Shopify la marca viaja en el propio pedido (`note_attributes`, `tags`).
   * En Tiendanube, WooCommerce o Mercado Libre no hay dónde ponerla, así que
   * la prueba es que la fila de `orders` diga que la creó el asistente.
   */
  const espejoDePedido = new Map<
    string,
    {
      created_by?: string | null;
      channel?: string | null;
      checkout_token?: string | null;
      /** Quién compró, cuando la tienda no lo dice. Ver Mercado Libre. */
      contact_id?: string | null;
    }
  >();
  {
    const ids = orders.map((o) => String(o.id));
    if (ids.length > 0) {
      const { data: espejos } = await admin
        .from('orders')
        .select('shopify_order_id, created_by, channel, checkout_token, contact_id')
        .eq('workspace_id', workspaceId)
        .in('shopify_order_id', ids);
      const sinNombre: string[] = [];
      for (const e of (espejos ?? []) as {
        shopify_order_id: string;
        created_by?: string | null;
        channel?: string | null;
        checkout_token?: string | null;
        contact_id?: string | null;
      }[]) {
        espejoDePedido.set(e.shopify_order_id, {
          created_by: e.created_by,
          channel: e.channel,
          checkout_token: e.checkout_token,
          contact_id: e.contact_id,
        });
        if (e.contact_id && !nombreDeContacto.has(e.contact_id)) {
          sinNombre.push(e.contact_id);
        }
      }
      // Los que sólo se conocen por el espejo —Mercado Libre, sobre todo, que
      // anonimiza correo y teléfono— no pasaron por las consultas de arriba.
      if (sinNombre.length > 0) {
        const { data: extra } = await admin
          .from('contacts')
          .select('id, name, email, phone')
          .eq('workspace_id', workspaceId)
          .in('id', sinNombre.slice(0, 500));
        for (const c of (extra ?? []) as {
          id: string;
          name?: string | null;
          email?: string | null;
          phone?: string | null;
        }[]) {
          const etiqueta = c.name?.trim() || c.email || c.phone || '';
          if (etiqueta) nombreDeContacto.set(c.id, etiqueta);
        }
      }
    }
  }

  /**
   * Los carritos abandonados a los que Riverz les mandó el recordatorio.
   *
   * Es la prueba de la recuperación de carrito: el link que se manda es el de
   * la tienda y no lleva marca nuestra, pero el pedido que lo cierra reusa el
   * mismo token de checkout. Si ese carrito se compró después del mensaje, la
   * venta es de Riverz sin lugar a discusión.
   *
   * La ventana arranca antes que el rango de pedidos porque el recordatorio
   * sale antes de la compra —a veces días antes— y si no, el carrito que se
   * recuperó hoy pero se recordó ayer quedaría sin prueba.
   *
   * `recovery_last_error IS NULL` filtra los envíos que se sabe que fallaron:
   * un carrito que nunca recibió el mensaje no se recuperó gracias a nosotros.
   */
  const carritosRecordados = new Map<string, string>();
  {
    const desde = new Date(sinceMs - 30 * 86_400_000).toISOString();
    const recordados = await traerTodo<{
      checkout_id: string;
      recovery_dispatched_at: string;
    }>((a, b) =>
      admin
        .from('shopify_checkouts')
        .select('checkout_id, recovery_dispatched_at')
        .eq('workspace_id', workspaceId)
        .not('recovery_dispatched_at', 'is', null)
        .is('recovery_last_error', null)
        .gte('recovery_dispatched_at', desde)
        .order('checkout_id')
        .range(a, b),
    );
    for (const c of recordados) {
      carritosRecordados.set(c.checkout_id, c.recovery_dispatched_at);
    }
  }

  /**
   * Los pagos rechazados que volvieron. Su motor ya hizo el cruce y guardó el
   * id del pedido con el que la persona volvió; acá sólo se lee, para que esa
   * plata —que hoy vivía sólo en su propia planilla— aparezca en la cifra.
   */
  const pagosRecuperados = new Set<string>();
  {
    const recuperados = await traerTodo<{ recovered_order_id: string }>((a, b) =>
      admin
        .from('mp_rejected_payments')
        .select('recovered_order_id')
        .eq('workspace_id', workspaceId)
        .not('recovered_order_id', 'is', null)
        .gte('recovered_at', new Date(sinceMs - 30 * 86_400_000).toISOString())
        .order('recovered_order_id')
        .range(a, b),
    );
    for (const r of recuperados) {
      pagosRecuperados.add(r.recovered_order_id);
    }
  }

  /**
   * Los cupones que Riverz emitió para UNA persona. Que un pedido entre con
   * uno es prueba dura: ese código no existía antes y no lo tuvo nadie más.
   * Hoy los emite el Agente de IG; cualquier otro emisor entra por acá.
   */
  const cuponesPropios = new Map<string, string>();
  {
    // Dos emisores, mismo peso como prueba: el Agente de IG (uno por
    // destinatario de campaña) y el asistente cuando le concede un descuento a
    // alguien en la conversación. Ese segundo faltaba, y es el más común: el
    // agente negocia el descuento, la persona compra con ÉSE código, y la
    // venta caía en «influidas» como si nadie hubiera hecho nada.
    const [igs, agente] = await Promise.all([
      traerTodo<{ contact_id: string | null; discount_code: string | null }>((d, h) =>
        admin
          .from('instagram_campaign_recipients')
          .select('contact_id, discount_code, instagram_campaigns!inner(workspace_id)')
          .eq('instagram_campaigns.workspace_id', workspaceId)
          .not('discount_code', 'is', null)
          .order('contact_id', { ascending: true })
          .range(d, h),
      ),
      traerTodo<{ contact_id: string | null; code: string | null }>((d, h) =>
        admin
          .from('agent_discounts')
          .select('contact_id, code')
          .eq('workspace_id', workspaceId)
          .order('contact_id', { ascending: true })
          .range(d, h),
      ),
    ]);
    for (const r of igs) {
      const code = (r.discount_code ?? '').trim().toLowerCase();
      if (code) cuponesPropios.set(code, r.contact_id ?? '');
    }
    for (const r of agente) {
      const code = (r.code ?? '').trim().toLowerCase();
      if (code) cuponesPropios.set(code, r.contact_id ?? '');
    }
  }

  /**
   * Las cuatro lentes, en cuatro consultas y no en cuatro POR PEDIDO.
   *
   * Antes el bucle preguntaba a la base cuatro veces por cada pedido del
   * rango: con doscientos pedidos eran ochocientas idas y vueltas en fila, y
   * la tarjeta se quedaba minutos en blanco —o el fetch moría y el panel
   * mostraba un cero con la moneda equivocada, que es peor que no mostrar
   * nada—. Se trae todo de una y el cruce se hace en memoria.
   */
  /**
   * Quién compró.
   *
   * Por correo, por teléfono, y —si la tienda no da ninguno de los dos— por la
   * fila espejo. Ese último camino es el único que sirve en Mercado Libre, que
   * anonimiza al comprador: sin él, un comercio de ML no tenía ni una venta
   * emparejada por más que la conversación estuviera ahí.
   */
  const contactoDelPedido = (o: (typeof orders)[number]): string | null =>
    (o.email && emailToContact.get(o.email.toLowerCase())) ||
    (o.phone && phoneToContact.get(normPhone(o.phone) ?? '')) ||
    espejoDePedido.get(String(o.id))?.contact_id ||
    null;

  const contactosConPedido = new Set<string>();
  for (const o of orders) {
    const id = contactoDelPedido(o);
    if (id) contactosConPedido.add(id);
  }

  /**
   * Cuándo le salió a cada comprador un mensaje NUESTRO, y por qué hilo.
   *
   * Existe por un agujero que costó caro: `recovery_dispatched_at` no
   * significa "le mandamos el recordatorio del carrito". Significa "el cron
   * reclamó esta fila para que otro tick no la mande dos veces", y lo escribe
   * ANTES de intentar el envío. Después hay seis caminos por los que no sale
   * nada —ya se le escribió en 24 h, tiene un pago rechazado abierto, un
   * carrito hermano suyo ya fue reclamado, la automatización esperó 15 minutos
   * y para entonces la persona ya había comprado— y en los seis la marca queda
   * puesta.
   *
   * Medido en Pilar el 2026-08-30: de 37 pedidos que la cifra daba por
   * probados por carrito recuperado, **36 no habían recibido ni un mensaje**.
   * Los carritos vivían 94, 112, 122 segundos: gente comprando normal, que el
   * cron reclamaba a los 18 segundos de abrir el checkout. La cifra principal
   * estaba inflada 50 veces.
   *
   * La prueba de un carrito recuperado pasa a ser lo que siempre debió ser:
   * que a esa persona le HAYA SALIDO un mensaje, y que haya comprado después.
   * Con el mismo mapa se resuelve a qué hilo lleva cada renglón del detalle.
   */
  const salidasPorContacto = new Map<string, Array<{ at: string; conv: string }>>();
  {
    const convsDeCompradores: string[] = [];
    for (const cId of contactosConPedido) {
      convsDeCompradores.push(...(convDeContacto.get(cId) ?? []));
    }
    const deConv = new Map<string, string>();
    for (const cId of contactosConPedido) {
      for (const convId of convDeContacto.get(cId) ?? []) deConv.set(convId, cId);
    }
    if (convsDeCompradores.length > 0) {
      const salidas = await traerTodo<{
        conversation_id: string | null;
        created_at: string;
      }>((a, b) =>
        admin
          .from('messages')
          .select('conversation_id, created_at')
          // Todo lo que no escribió el cliente salió de Riverz: la IA, una
          // plantilla, una persona del equipo desde la bandeja.
          .neq('sender_type', 'customer')
          .in('conversation_id', convsDeCompradores.slice(0, 2000))
          .gte('created_at', new Date(sinceMs - 60 * 86_400_000).toISOString())
          .order('created_at')
          .range(a, b),
      );
      for (const m of salidas) {
        const cId = m.conversation_id ? deConv.get(m.conversation_id) : null;
        if (!cId || !m.conversation_id) continue;
        const lista = salidasPorContacto.get(cId) ?? [];
        lista.push({ at: m.created_at, conv: m.conversation_id });
        salidasPorContacto.set(cId, lista);
      }
    }
  }

  /** ¿A esta persona le salió un mensaje entre `desde` y el pedido? */
  const leEscribimosEntre = (
    contactId: string | null,
    desdeIso: string,
    hastaIso: string,
  ): boolean => {
    if (!contactId) return false;
    const desde = Date.parse(desdeIso);
    const hasta = Date.parse(hastaIso);
    return (salidasPorContacto.get(contactId) ?? []).some((m) => {
      const t = Date.parse(m.at);
      return t >= desde && t <= hasta;
    });
  };

  /**
   * A qué hilo lleva el renglón: aquel donde Riverz habló con esta persona
   * ANTES de que comprara.
   *
   * Antes se tomaba la primera conversación de la lista, y esa lista venía
   * ordenada por el uuid de la conversación — o sea al azar. Con una persona
   * de un solo hilo acertaba de casualidad; con dos, era una moneda al aire,
   * y el renglón que decía "carrito abandonado" abría un chat de "nuevo
   * pedido". 37 de cada 881 contactos tienen más de un hilo.
   */
  const hiloDelPedido = (contactId: string | null, hastaIso: string): string | null => {
    if (!contactId) return null;
    const hasta = Date.parse(hastaIso);
    const previas = (salidasPorContacto.get(contactId) ?? []).filter(
      (m) => Date.parse(m.at) <= hasta,
    );
    if (previas.length > 0) return previas[previas.length - 1].conv;
    // Nunca le escribimos antes de comprar: no hay hilo que explique la venta,
    // pero sí uno donde seguir la conversación. El primero es mejor que nada.
    return convDeContacto.get(contactId)?.[0] ?? null;
  };
  const toquesPorContacto = await prefetchToques(admin, {
    workspaceId,
    locale,
    contactIds: Array.from(contactosConPedido),
    convDeContacto,
    // La ventana arranca antes del rango: un pedido del primer día pudo
    // haberse originado en un mensaje del día anterior.
    desde: new Date(sinceMs - lookbackMs).toISOString(),
    hasta: untilIso,
  });
  const bucketDe = (kind: SourceKind): Map<string, AttrRow> =>
    kind === 'broadcast'
      ? byBroadcast
      : kind === 'flow'
        ? byFlow
        : kind === 'automation'
          ? byAutomation
          : byAgent;

  for (const order of orders) {
    // La prueba se calcula ANTES de buscar el contacto y no depende de él: un
    // pedido que salió de un link del asistente está probado aunque la persona
    // haya pagado con otro correo y no matchee ningún contacto. Buscarlo
    // primero, como se hacía, tiraba esas ventas a la basura.
    const crudas = provenBy(
      order,
      espejoDePedido.get(String(order.id)) ?? null,
      cuponesPropios,
      carritosRecordados,
      pagosRecuperados,
    );

    const cId = contactoDelPedido(order);

    /**
     * El carrito recuperado sólo prueba si el mensaje SALIÓ.
     *
     * `provenBy` es puro y no puede saberlo: la marca del carrito vive en
     * `shopify_checkouts` y el envío vive en `messages`. El cruce se hace acá,
     * que es donde están los dos. Ver `salidasPorContacto` arriba para el
     * agujero que esto tapa.
     */
    const proofs = crudas.filter((p) => {
      if (p.kind !== 'cart_recovery') return true;
      const token = (
        order.checkout_token ??
        order.cart_token ??
        espejoDePedido.get(String(order.id))?.checkout_token ??
        ''
      ).trim();
      const reclamado = token ? carritosRecordados.get(token) : undefined;
      if (!reclamado) return false;
      return leEscribimosEntre(cId, reclamado, order.created_at);
    });

    const orderTime = new Date(order.created_at).getTime();
    const total = Number(order.total_price ?? '0');
    const currency = order.currency || moneda;
    // Con qué habló esta persona antes de comprar. NO prueba la venta: es
    // contexto, y es lo que separa "influida" de "no la tocamos". Sin contacto
    // emparejado no hay nada que mirar, pero el pedido puede seguir estando
    // probado por su marca.
    const fuentes: AttributedOrder['sources'] = cId
      ? ultimoToquePorLente(toquesPorContacto.get(cId) ?? [], orderTime, lookbackMs)
      : [];
    for (const f of fuentes) {
      accumulate(bucketDe(f.kind), f.entityId, f.name, total, currency);
    }

    // La regla entera, en una línea: con marca cuenta como venta de Riverz;
    // sin marca, sólo se registra que hubo conversación antes.
    const evidence: 'proven' | 'assisted' | null =
      proofs.length > 0 ? 'proven' : fuentes.length > 0 ? 'assisted' : null;
    if (!evidence) continue;

    const cubeta = evidence === 'proven' ? attributed : assisted;
    cubeta.orders += 1;
    cubeta.revenue += total;
    cubeta.currency = currency;

    detalle.push({
      id: String(order.id),
      reference:
        order.name?.trim() ||
        (order.order_number != null ? `#${order.order_number}` : `#${order.id}`),
      created_at: order.created_at,
      revenue: total,
      currency,
      contact: cId ? (nombreDeContacto.get(cId) ?? null) : null,
      contact_id: cId,
      // El hilo donde Riverz habló con esta persona antes de que comprara.
      // Sin esto, el detalle contaba de dónde salió cada venta y no dejaba ir a
      // verla: había que copiar el nombre y buscarlo a mano en la bandeja.
      conversation_id: hiloDelPedido(cId, order.created_at),
      // Lo más reciente primero: el mensaje que llegó último es el que
      // mejor explica la compra.
      sources: fuentes.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
      evidence,
      proofs,
      from_ad: cId ? contactosDeAnuncio.has(cId) : false,
    });
  }

  attributed.revenue = Math.round(attributed.revenue * 100) / 100;
  assisted.revenue = Math.round(assisted.revenue * 100) / 100;

  /**
   * Las ventas probadas, según quién atendió a esa persona.
   *
   * Es la comparación que ninguna otra métrica puede dar: no "la IA es más
   * barata" sino **la IA vende**. Se mira si en las conversaciones de cada
   * comprador escribió alguna PERSONA (`sender_type='agent'`); si no escribió
   * nadie, esa venta se cerró sola.
   *
   * Una sola consulta sobre los contactos que ya compraron, no sobre todos.
   */
  const porQuienAtendio = { ia: { orders: 0, revenue: 0 }, humano: { orders: 0, revenue: 0 } };
  {
    const convsDeCompradores: string[] = [];
    for (const p of detalle) {
      if (p.contact_id) convsDeCompradores.push(...(convDeContacto.get(p.contact_id) ?? []));
    }
    const conPersona = new Set<string>();
    if (convsDeCompradores.length > 0) {
      const humanos = await traerTodo<{ conversation_id: string | null }>(
        (a, b) =>
          admin
            .from('messages')
            .select('conversation_id')
            .eq('sender_type', 'agent')
            .in('conversation_id', convsDeCompradores.slice(0, 2000))
            .order('id')
            .range(a, b),
      );
      for (const m of humanos) {
        if (m.conversation_id) conPersona.add(m.conversation_id);
      }
    }
    for (const p of detalle) {
      if (p.evidence !== 'proven') continue;
      const convs = p.contact_id ? (convDeContacto.get(p.contact_id) ?? []) : [];
      const lado = convs.some((c) => conPersona.has(c))
        ? porQuienAtendio.humano
        : porQuienAtendio.ia;
      lado.orders += 1;
      lado.revenue += p.revenue;
    }
    porQuienAtendio.ia.revenue = Math.round(porQuienAtendio.ia.revenue * 100) / 100;
    porQuienAtendio.humano.revenue = Math.round(porQuienAtendio.humano.revenue * 100) / 100;
  }
  // Probadas primero y, dentro de cada grupo, por plata: lo que se puede
  // defender va arriba.
  detalle.sort(
    (a, b) =>
      Number(b.evidence === 'proven') - Number(a.evidence === 'proven') ||
      b.revenue - a.revenue,
  );

  return {
    days,
    by_broadcast: sortByRevenue(byBroadcast),
    by_flow: sortByRevenue(byFlow),
    by_automation: sortByRevenue(byAutomation),
    by_agent: sortByRevenue(byAgent),
    by_instagram_agent,
    totals,
    attributed,
    assisted,
    by_handler: porQuienAtendio,
    attributed_orders: detalle.slice(0, MAX_DETALLE),
    attributed_orders_truncated: detalle.length > MAX_DETALLE,
    // El rango que produjo estas cifras, para que se puedan leer solas.
    //
    // Sin esto, dos pantallas del mismo panel mostrando numeros distintos son
    // indistinguibles de un bug: no hay forma de saber si miran el mismo
    // periodo. Viaja en la respuesta y no como prop porque quien lo tiene que
    // decir es quien lo calculo.
    range: { start: sinceIso, end: untilIso },
  };
}

/**
 * Qué mensajes de Riverz tocaron a cada comprador, traído de una sola vez.
 *
 * Cuatro lentes —campaña, flujo, automatización, asistente— y cuatro consultas
 * en total, no cuatro por pedido. Devuelve, por contacto, la lista de toques
 * ordenada del más nuevo al más viejo; después cada pedido se queda con el
 * último de cada lente que caiga dentro de su ventana.
 *
 * Esto NO prueba la venta y por eso vive lejos de `provenBy`: contesta "hubo
 * conversación antes", que es la mitad floja de la atribución.
 */
async function prefetchToques(
  admin: SupabaseClient,
  args: {
    workspaceId: string;
    locale: Locale;
    contactIds: string[];
    convDeContacto: Map<string, string[]>;
    desde: string;
    hasta: string;
  },
): Promise<Map<string, Toque[]>> {
  const { workspaceId, locale, contactIds, convDeContacto, desde, hasta } = args;
  const porContacto = new Map<string, Toque[]>();
  if (contactIds.length === 0) return porContacto;

  const push = (contactId: string, toque: Toque) => {
    const lista = porContacto.get(contactId) ?? [];
    lista.push(toque);
    porContacto.set(contactId, lista);
  };
  const nombreJoin = (
    join: { name?: string } | { name?: string }[] | null | undefined,
    fallback: string,
  ): string => {
    const row = Array.isArray(join) ? join[0] : join;
    return row?.name ?? translate(locale, fallback);
  };

  // Las cuatro en paralelo: son independientes y esperar una por una era la
  // otra mitad de la demora.
  const [bcs, flows, autos, convs] = await Promise.all([
    traerTodo((a, b) =>
      admin
        .from('broadcast_recipients')
        .select('contact_id, broadcast_id, sent_at, broadcasts(name)')
        .in('contact_id', contactIds)
        .gte('sent_at', desde)
        .lte('sent_at', hasta)
        .order('sent_at')
        .range(a, b),
    ).then((data) => ({ data })),
    traerTodo((a, b) =>
      admin
        .from('flow_runs')
        .select('contact_id, flow_id, started_at, flows(name)')
        .eq('workspace_id', workspaceId)
        .in('contact_id', contactIds)
        .gte('started_at', desde)
        .lte('started_at', hasta)
        .order('started_at')
        .range(a, b),
    ).then((data) => ({ data })),
    traerTodo((a, b) =>
      admin
        .from('automation_logs')
        .select('contact_id, automation_id, created_at, automations(name)')
        .eq('workspace_id', workspaceId)
        .in('contact_id', contactIds)
        .in('status', ['success', 'partial'])
        .gte('created_at', desde)
        .lte('created_at', hasta)
        .order('created_at')
        .range(a, b),
    ).then((data) => ({ data })),
    (async () => {
      // `ai_replies` guarda conversación, no contacto: hace falta el mapa
      // inverso para saber de quién es cada respuesta.
      const deConv = new Map<string, string>();
      const ids: string[] = [];
      for (const cId of contactIds) {
        for (const convId of convDeContacto.get(cId) ?? []) {
          deConv.set(convId, cId);
          ids.push(convId);
        }
      }
      if (ids.length === 0) return { data: [], deConv };
      const data = await traerTodo((a, b) =>
        admin
          .from('ai_replies')
          .select('conversation_id, agent_id, created_at, ai_agents(name)')
          .eq('workspace_id', workspaceId)
          .eq('status', 'sent')
          // Tope duro: `in` viaja en la URL y con miles de uuids PostgREST
          // devuelve 414 y la lente entera se pierde en silencio.
          .in('conversation_id', ids.slice(0, 2000))
          .gte('created_at', desde)
          .lte('created_at', hasta)
          .order('created_at')
          .range(a, b),
      );
      return { data, deConv };
    })(),
  ]);

  for (const r of (bcs.data ?? []) as {
    contact_id: string;
    broadcast_id: string;
    sent_at: string;
    broadcasts: { name?: string } | { name?: string }[];
  }[]) {
    push(r.contact_id, {
      kind: 'broadcast',
      entityId: r.broadcast_id,
      name: nombreJoin(r.broadcasts, 'errInbox.broadcastFallback'),
      at: r.sent_at,
    });
  }

  for (const r of (flows.data ?? []) as {
    contact_id: string;
    flow_id: string;
    started_at: string;
    flows: { name?: string } | { name?: string }[];
  }[]) {
    push(r.contact_id, {
      kind: 'flow',
      entityId: r.flow_id,
      name: nombreJoin(r.flows, 'errInbox.flowFallback'),
      at: r.started_at,
    });
  }

  for (const r of (autos.data ?? []) as {
    contact_id: string;
    automation_id: string;
    created_at: string;
    automations: { name?: string } | { name?: string }[];
  }[]) {
    push(r.contact_id, {
      kind: 'automation',
      entityId: r.automation_id,
      name: nombreJoin(r.automations, 'errInbox.automationFallback'),
      at: r.created_at,
    });
  }

  // La lente que más se usa: un comercio puede tener a la IA cerrando ventas
  // todo el día y ver «ventas por Riverz: 0» si sólo se miran las otras tres.
  for (const r of convs.data as {
    conversation_id: string;
    agent_id: string | null;
    created_at: string;
    ai_agents: { name?: string } | { name?: string }[] | null;
  }[]) {
    const cId = convs.deConv.get(r.conversation_id);
    if (!cId) continue;
    push(cId, {
      kind: 'agent',
      entityId: r.agent_id ?? 'sin-agente',
      name: nombreJoin(r.ai_agents, 'errInbox.agentFallback'),
      at: r.created_at,
    });
  }

  // Del más nuevo al más viejo: el matcher de abajo se queda con el primero
  // que entre en la ventana, que es el último toque.
  for (const lista of porContacto.values()) {
    lista.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
  return porContacto;
}

/** Add one order's revenue to the bucket keyed by entity id (last-touch). */
function accumulate(
  bucket: Map<string, AttrRow>,
  id: string,
  name: string,
  total: number,
  currency: string,
): void {
  const cur =
    bucket.get(id) ?? { id, name, orders_count: 0, revenue: 0, currency };
  cur.orders_count += 1;
  cur.revenue += total;
  bucket.set(id, cur);
}

function sortByRevenue(bucket: Map<string, AttrRow>): AttrRow[] {
  return Array.from(bucket.values()).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Revenue del Agente de IG dentro de la ventana. A diferencia de los otros
 * buckets, NO recalcula sobre las órdenes en vivo: lee el revenue que el motor
 * del agente ya atribuyó por destinatario (determinista por código + control).
 *
 * Ojo: ventana por `converted_at` = cuándo el motor RECONOCIÓ la venta (lo
 * estampa con NOW al correr el cron), no `created_at` de la orden. Los otros
 * tres buckets sí usan la fecha de la orden. El desfase está acotado (el motor
 * atribuye dentro de ~7 días del envío), pero por eso este lente mide
 * "reconocido en los últimos N días", no "comprado". `orders_count` aquí cuenta
 * destinatarios convertidos (1 por persona), equivalente a órdenes en la práctica.
 */
async function attributeInstagramAgent(
  admin: SupabaseClient,
  workspaceId: string,
  sinceIso: string,
  untilIso: string,
  locale: Locale,
): Promise<AttrRow[]> {
  const data = await traerTodo<unknown>((d, h) =>
    admin
      .from('instagram_campaign_recipients')
      .select('revenue, currency, campaign_id, instagram_campaigns!inner(name, workspace_id)')
      .eq('status', 'converted')
      .eq('instagram_campaigns.workspace_id', workspaceId)
      .gte('converted_at', sinceIso)
      .lt('converted_at', untilIso)
      .not('revenue', 'is', null)
      .order('campaign_id', { ascending: true })
      .range(d, h),
  );

  const map = new Map<string, AttrRow>();
  for (const r of data) {
    const row = r as {
      revenue: number | null;
      currency: string | null;
      campaign_id: string;
      instagram_campaigns: { name?: string } | { name?: string }[] | null;
    };
    const join = Array.isArray(row.instagram_campaigns)
      ? row.instagram_campaigns[0]
      : row.instagram_campaigns;
    const cur =
      map.get(row.campaign_id) ?? {
        id: row.campaign_id,
        name: join?.name ?? translate(locale, 'errInbox.igCampaignFallback'),
        orders_count: 0,
        revenue: 0,
        currency: row.currency || 'USD',
      };
    cur.orders_count += 1;
    cur.revenue += Number(row.revenue ?? 0) || 0;
    if (row.currency) cur.currency = row.currency;
    map.set(row.campaign_id, cur);
  }
  return sortByRevenue(map);
}
