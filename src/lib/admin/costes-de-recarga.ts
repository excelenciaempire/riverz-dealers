/**
 * Lo que cuesta meterle plata a cada plataforma.
 *
 * Vive en su propio módulo, sin una sola importación de servidor, para que la
 * pantalla que sólo la muestra pueda traerla directo. Cuando estaba dentro de
 * `caja.ts` —que importa Supabase— la pestaña de referencia tenía que pedirle
 * la tabla a `/api/admin/caja`, y esa ruta puede disparar la ronda de sondas
 * FACTURABLES de los proveedores. Abrir una tabla que no cambia nunca costaba
 * cuatro completions.
 */

/**
 * No es el precio por token —ese lo cobra la billetera y se ve en Negocio—
 * sino la fricción de la recarga: el recargo por pagar con tarjeta, el mínimo,
 * y si los créditos vencen. Es lo que decide CUÁNTO y CADA CUÁNTO conviene
 * cargar, y no está en ninguna API: se investigó una vez y vive acá para no
 * volver a buscarlo en once tableros.
 *
 * Verificado el 2026-08-30 contra la documentación de cada proveedor.
 */
export interface CosteDeRecarga {
  id: string
  /** Nombre comercial. No se traduce: es un nombre propio. */
  nombre: string
  modelo: 'prepago' | 'suscripcion' | 'mixto'
  /** Recargo por cargar saldo, en porcentaje. 0 = no cobra por cargar. */
  recargoPct: number
  /** Mínimo de recarga en USD. Null = no tiene. */
  minimoUsd: number | null
  /** Meses hasta que vencen los créditos. 0 = al cierre del ciclo.
   *  Null = no vencen. */
  venceMeses: number | null
  /** Clave i18n de la advertencia, cuando hay una que cuesta plata ignorar. */
  notaKey: string | null
  url: string
}

/**
 * Va compilada y no en la base a propósito: son condiciones comerciales que
 * cambian una o dos veces por año, y una tabla editable pediría una pantalla
 * de edición para un dato que nadie toca.
 */
export const COSTES: CosteDeRecarga[] = [
  {
    id: 'anthropic',
    nombre: 'Anthropic',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: 5,
    venceMeses: 12,
    notaKey: 'admin.cashNoteAnthropic',
    url: 'https://console.anthropic.com/settings/billing',
  },
  {
    id: 'telnyx',
    nombre: 'Telnyx',
    modelo: 'prepago',
    recargoPct: 3,
    minimoUsd: 10,
    venceMeses: null,
    notaKey: 'admin.cashNoteTelnyx',
    url: 'https://portal.telnyx.com/#/app/billing/payments',
  },
  {
    id: 'deepgram',
    nombre: 'Deepgram',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: null,
    notaKey: 'admin.cashNoteDeepgram',
    url: 'https://console.deepgram.com/',
  },
  {
    id: 'fish',
    nombre: 'Fish Audio',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: null,
    notaKey: 'admin.cashNoteFish',
    url: 'https://fish.audio/go-api/',
  },
  {
    id: 'groq',
    nombre: 'Groq',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: 12,
    notaKey: null,
    url: 'https://console.groq.com/settings/billing',
  },
  {
    id: 'gemini',
    nombre: 'Google Gemini',
    modelo: 'mixto',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: null,
    notaKey: 'admin.cashNoteGemini',
    url: 'https://aistudio.google.com/app/billing',
  },
  {
    id: 'elevenlabs',
    nombre: 'ElevenLabs',
    modelo: 'suscripcion',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: 12,
    notaKey: 'admin.cashNoteElevenlabs',
    url: 'https://elevenlabs.io/app/subscription',
  },
  {
    id: 'firecrawl',
    nombre: 'Firecrawl',
    modelo: 'suscripcion',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: 0,
    notaKey: 'admin.cashNoteFirecrawl',
    url: 'https://www.firecrawl.dev/app/usage',
  },
  {
    id: 'apify',
    nombre: 'Apify',
    modelo: 'suscripcion',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: 0,
    notaKey: 'admin.cashNoteApify',
    url: 'https://console.apify.com/billing',
  },
  {
    id: 'whatsapp',
    nombre: 'Meta / WhatsApp',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: null,
    notaKey: 'admin.cashNoteMeta',
    url: 'https://business.facebook.com/billing_hub/accounts',
  },
]
