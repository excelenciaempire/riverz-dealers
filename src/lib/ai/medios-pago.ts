/**
 * Con qué se puede pagar en este comercio.
 *
 * Era la pregunta más común sin respuesta. El agente sabía mandar a la caja
 * pero no sabía decir con QUÉ se paga en ella, así que escalaba — o peor, lo
 * deducía: el 2026-08-29 le confirmó "pago contra entrega" a la clienta de un
 * comercio que no lo acepta, en público bajo el anuncio, y le pidió la
 * dirección.
 *
 * La lista se declara UNA vez, al crear el asistente. `null` es un estado real
 * y distinto de la lista vacía: significa "todavía no lo dijo", y con eso el
 * agente no nombra ninguno y no confirma contra entrega. Es el lado seguro, y
 * es donde arranca todo asistente nuevo.
 *
 * Módulo PURO y sin i18n: las etiquetas viven en el catálogo `operation`
 * porque las lee el comercio, y estas claves las lee el prompt, que sigue el
 * idioma del agente. Ver `runner.ts` y `medios-pago.test.ts`.
 */

export const MEDIOS_PAGO = [
  'tarjeta',
  'transferencia',
  'mercadopago',
  'efectivo',
  'contraentrega',
  'link_de_pago',
] as const;

export type MedioDePago = (typeof MEDIOS_PAGO)[number];

/** Cómo se nombra cada uno adentro del prompt, en el idioma del agente. */
const NOMBRE: Record<MedioDePago, { es: string; en: string }> = {
  tarjeta: { es: 'tarjeta de crédito o débito', en: 'credit or debit card' },
  transferencia: { es: 'transferencia bancaria', en: 'bank transfer' },
  mercadopago: { es: 'Mercado Pago', en: 'Mercado Pago' },
  efectivo: { es: 'efectivo', en: 'cash' },
  contraentrega: { es: 'pago al recibir (contra entrega)', en: 'cash on delivery' },
  link_de_pago: { es: 'link de pago', en: 'payment link' },
};

/**
 * Lo que el comercio declaró, filtrado y en orden estable.
 *
 * Devuelve `null` cuando no declaró nada — que NO es lo mismo que la lista
 * vacía. Un valor inventado se descarta en silencio: la columna es jsonb y
 * cualquiera puede escribirle cualquier cosa, y un medio de pago que no
 * existe en el prompt es una promesa que el comercio no puede cumplir.
 */
export function mediosDeclarados(raw: unknown): MedioDePago[] | null {
  if (!Array.isArray(raw)) return null;
  const validos = MEDIOS_PAGO.filter((m) => raw.includes(m));
  return [...validos];
}

/** ¿Se cobra al recibir? `null` = no lo declaró, que no es "no". */
export function aceptaContraentrega(raw: unknown): boolean | null {
  const lista = mediosDeclarados(raw);
  if (lista === null) return null;
  return lista.includes('contraentrega');
}

/**
 * "tarjeta de crédito o débito, Mercado Pago y transferencia bancaria".
 *
 * Con la conjunción, porque va adentro de una oración del prompt y una lista
 * separada por comas ahí se lee como una enumeración de máquina.
 */
export function frase(lista: MedioDePago[], locale: 'es' | 'en' = 'es'): string {
  const nombres = lista.map((m) => NOMBRE[m][locale]);
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return nombres[0];
  const y = locale === 'en' ? 'and' : 'y';
  return `${nombres.slice(0, -1).join(', ')} ${y} ${nombres[nombres.length - 1]}`;
}
