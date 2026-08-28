import type { Namespace } from "./types";

/**
 * Copy propio de la portada oscura (riverz.co/portada-c).
 *
 * Casi todo lo lee de otros dos catálogos y NO lo repite:
 *
 *  - `landingV4.*` para el titular, la descripción, el Loop, el Operator, los
 *    pilares y el cierre. Es el mismo producto contado igual; lo que cambia
 *    entre las dos portadas es la piel, no lo que se promete.
 *  - `landing.*` para las trece funciones, que ya están trabajadas en la
 *    portada principal.
 *
 * Acá viven solo las piezas que esta versión tiene y las otras no: los dos
 * botones del hero, la tira de fotos y las etiquetas de sección propias.
 */
export const landingV5 = {
  metaTitle: { es: "riverz", en: "riverz" },

  // Los dos botones del hero. Shopify siempre pone dos —uno macizo y uno de
  // contorno— y el segundo no compite: lleva a ver, no a registrarse.
  heroCta: { es: "Conectar mi tienda", en: "Connect my store" },
  heroCtaAlt: { es: "Ver cómo funciona", en: "See how it works" },

  // La tira de fotos debajo del hero.
  tiraTitle: {
    es: "Vende donde ya te escriben. Y también donde todavía no.",
    en: "Sell where they already write you. And where they don't yet.",
  },
  tiraAlt1: { es: "Preparando un pedido", en: "Packing an order" },
  tiraAlt2: { es: "Producto en el mostrador", en: "Product on the counter" },
  tiraAlt3: { es: "Atendiendo desde el teléfono", en: "Answering from a phone" },
  tiraAlt4: { es: "Estante de la tienda", en: "Shop shelf" },
  heroAlt: {
    es: "Una comerciante atendiendo desde su teléfono, de noche, en su tienda",
    en: "A shop owner answering from her phone at night in her store",
  },
  equipoAlt: {
    es: "Un equipo pequeño trabajando de noche alrededor de una mesa",
    en: "A small team working late around one table",
  },

  // El bloque de cifras. Son capacidades verificables, no resultados: el
  // producto está en prelanzamiento y una cifra de facturación inventada se
  // huele a un kilómetro.
  cifrasLabel: { es: "De qué está hecho", en: "What it's made of" },
  cifrasTitle: {
    es: "Un sistema, no una bandeja más",
    en: "One system, not another inbox",
  },
  cifra1: { es: "canales en una sola bandeja", en: "channels in a single inbox" },
  cifra2: { es: "herramientas que el agente ejecuta", en: "tools the agent runs" },
  cifra3: { es: "especialistas que se reparten el trabajo", en: "specialists splitting the work" },
  cifra4: { es: "plataformas de tienda conectadas", en: "store platforms connected" },

  // Cierre.
  ctaAlt: { es: "Hablar con nosotros", en: "Talk to us" },
} satisfies Namespace;
