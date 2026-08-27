/**
 * Los países donde un comercio de Riverz compra su número.
 *
 * Existe porque el panel pedía el código ISO en una caja de texto de dos
 * letras. Un comercio colombiano escribía «COL», o «57», o «Colombia», y la
 * búsqueda volvía vacía sin decir por qué. Nadie sabe de memoria que su país
 * se escribe «CO» — y no tiene por qué.
 *
 * La lista es corta a propósito: son los mercados de Riverz más los dos donde
 * un comercio latino suele querer presencia. Para cualquier otro está la
 * opción de escribir el código a mano, que es el comportamiento viejo.
 */
export interface VoiceCountry {
  /** ISO-3166 alfa-2, que es lo que pide Telnyx. */
  code: string;
  name: string;
  /** Prefijo telefónico, para que se reconozca sin leer el nombre. */
  dial: string;
}

export const VOICE_COUNTRIES: VoiceCountry[] = [
  { code: 'CO', name: 'Colombia', dial: '+57' },
  { code: 'AR', name: 'Argentina', dial: '+54' },
  { code: 'MX', name: 'México', dial: '+52' },
  { code: 'CL', name: 'Chile', dial: '+56' },
  { code: 'PE', name: 'Perú', dial: '+51' },
  { code: 'EC', name: 'Ecuador', dial: '+593' },
  { code: 'UY', name: 'Uruguay', dial: '+598' },
  { code: 'PY', name: 'Paraguay', dial: '+595' },
  { code: 'BO', name: 'Bolivia', dial: '+591' },
  { code: 'BR', name: 'Brasil', dial: '+55' },
  { code: 'CR', name: 'Costa Rica', dial: '+506' },
  { code: 'PA', name: 'Panamá', dial: '+507' },
  { code: 'GT', name: 'Guatemala', dial: '+502' },
  { code: 'DO', name: 'Rep. Dominicana', dial: '+1' },
  { code: 'US', name: 'Estados Unidos', dial: '+1' },
  { code: 'ES', name: 'España', dial: '+34' },
];

/** La bandera sale del propio código: dos indicadores regionales. */
export function banderaDe(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🏳️';
  return String.fromCodePoint(
    ...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

/**
 * El país del comercio, deducido de la zona horaria del espacio de trabajo.
 *
 * Es la mejor pista que tenemos sin preguntar: la tz ya está guardada y es la
 * que usa la franja horaria de llamadas. Preseleccionar el país correcto le
 * ahorra al comercio la única decisión del panel que puede equivocar.
 */
const TZ_A_PAIS: [string, string][] = [
  ['America/Bogota', 'CO'],
  ['America/Argentina', 'AR'],
  ['America/Buenos_Aires', 'AR'],
  ['America/Mexico', 'MX'],
  ['America/Santiago', 'CL'],
  ['America/Lima', 'PE'],
  ['America/Guayaquil', 'EC'],
  ['America/Montevideo', 'UY'],
  ['America/Asuncion', 'PY'],
  ['America/La_Paz', 'BO'],
  ['America/Sao_Paulo', 'BR'],
  ['America/Costa_Rica', 'CR'],
  ['America/Panama', 'PA'],
  ['America/Guatemala', 'GT'],
  ['America/Santo_Domingo', 'DO'],
  ['Europe/Madrid', 'ES'],
];

export function paisDeTimezone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  for (const [prefijo, pais] of TZ_A_PAIS) {
    if (tz.startsWith(prefijo)) return pais;
  }
  // Cualquier otra zona de EE.UU. (New_York, Chicago, Los_Angeles…).
  if (tz.startsWith('America/') || tz.startsWith('US/')) return 'US';
  return null;
}

/**
 * Los tipos de número, en el orden en que conviene probarlos.
 *
 * El panel ya no le pide al comercio que elija: pregunta por «local» —el que
 * la gente contesta— y si el país no tiene, sigue solo con los demás. Un
 * comercio que vende cremas no tiene cómo saber qué es un número «nacional».
 */
export const TIPOS_EN_ORDEN = ['local', 'national', 'mobile', 'toll_free'] as const;
