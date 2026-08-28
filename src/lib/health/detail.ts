/**
 * El detalle del aviso, en el idioma de quien lo lee.
 *
 * `admin_workspace_issues` devuelve el detalle CRUDO a propósito: es lo más
 * accionable que tiene la fila y guardarlo traducido lo ataría al idioma que
 * tenía la cuenta el día del error. El costo era que la tarjeta de Inicio
 * mostraba cosas como «(#131008) Required parameter is missing» — un número y
 * una frase en inglés que no le dicen a nadie qué arreglar.
 *
 * Acá se traduce en el momento de mostrarlo. La regla es no perder información:
 * si no sabemos qué significa, se muestra el crudo tal cual. Un detalle vacío
 * es peor que uno feo.
 *
 * Módulo PURO: lo usan la tarjeta del comercio y el panel de plataforma.
 */
import type { Channel } from '@/types';
import { CHANNEL_DISPLAY, channelLabel } from '@/lib/channels/display';
import { deliveryErrorKey } from '@/lib/whatsapp/delivery-errors';
import type { IssueKind } from './issues';

type TFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Código de error de Meta dentro de un texto libre. Meta lo escribe de tres
 * formas — `(#131008)`, `[131008]`, `#131008` — y siempre marcado con `#` o
 * corchetes. Un número suelto NO cuenta: los nombres de plantilla y las
 * cantidades ("2 de 5 fallaron") también son dígitos.
 */
const META_CODE = /[(\[]#?(\d{3,6})[)\]]|#(\d{3,6})/;

export function metaCodeIn(text: string): number | null {
  const m = META_CODE.exec(text);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : null;
}

/**
 * El texto en inglés de Meta cuando viene SIN el código al lado.
 *
 * `deliveryErrorKey` ya sabe traducir cada código, pero sólo si hay un código
 * que leer. Meta manda muchos avisos como frase suelta —«In order to maintain a
 * healthy ecosystem engagement, the message failed to be delivered.»— y ésos se
 * caían hasta el `return raw` del final: una oración en inglés en medio de una
 * pantalla en castellano.
 *
 * Cada patrón devuelve el código que le corresponde y de ahí sale la misma
 * traducción que ya usa la bandeja: una sola redacción por error, no dos.
 */
const META_TEXTOS: Array<{ re: RegExp; code: number }> = [
  { re: /healthy ecosystem engagement/i, code: 131049 },
  { re: /24 hours have passed since|last replied to this number/i, code: 131047 },
  { re: /chosen to stop receiving marketing|stopped marketing messages/i, code: 131050 },
  { re: /part of an experiment/i, code: 130472 },
  { re: /message undeliverable/i, code: 131026 },
  { re: /spam rate limit/i, code: 131048 },
  { re: /too many messages sent from sender phone number/i, code: 131056 },
  { re: /template is paused|paused (due to|for) (low|poor) quality/i, code: 132015 },
  { re: /template is disabled|disabled (due to|for) (low|poor) quality/i, code: 132016 },
  { re: /number of parameters does not match/i, code: 132000 },
  { re: /required parameter is missing/i, code: 131008 },
  { re: /parameter value is not valid/i, code: 131009 },
  { re: /does not exist in .*translation|template name does not exist/i, code: 132001 },
  { re: /account (has been )?(locked|restricted)|business account is restricted/i, code: 131031 },
  { re: /payment method|business eligibility payment/i, code: 131042 },
  { re: /phone number (is )?not registered/i, code: 133010 },
  { re: /registration error/i, code: 131045 },
  { re: /media (download|upload) error|unable to download/i, code: 131052 },
  { re: /service temporarily unavailable/i, code: 131016 },
  { re: /business (has )?blocked this (user|number)/i, code: 130403 },
]

/** Patrones de error propios (no de Meta) que sí sabemos explicar. */
const PATTERNS: Array<{ re: RegExp; key: string; param?: 'name' }> = [
  { re: /template not found:?\s*(.+)/i, key: 'detailTemplateNamed', param: 'name' },
  { re: /no template|template not found|plantilla no encontrada/i, key: 'detailTemplateMissing' },
  { re: /no recipients?|sin destinatarios/i, key: 'detailNoRecipients' },
  { re: /invalid phone number|número inválido/i, key: 'detailInvalidPhone' },
  { re: /contacto dado de baja|unsubscrib|opted out/i, key: 'detailUnsubscribed' },
  { re: /no (whatsapp )?connection|sin conexión|not connected/i, key: 'detailNoConnection' },
  { re: /rate ?limit|too many requests/i, key: 'detailRateLimited' },
  { re: /timeout|timed out/i, key: 'detailTimeout' },
  { re: /unauthorized|invalid token|token expired|401/i, key: 'detailAuth' },
];

/** Las conexiones caídas llegan como slugs de canal y dominios de tienda. */
function connectionDetail(detail: string, t: TFn): string {
  return detail
    .split(',')
    .map((raw) => {
      const slug = raw.trim();
      return slug in CHANNEL_DISPLAY ? channelLabel(slug as Channel, t) : slug;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Texto legible del detalle de un aviso, o null si no hay detalle.
 *
 * Orden: primero el código de Meta (es lo más específico), después nuestros
 * patrones, y al final el crudo. Los nombres propios —plantillas, campañas—
 * no se tocan: son el dato.
 */
export function issueDetailText(
  kind: IssueKind,
  detail: string | null | undefined,
  t: TFn,
): string | null {
  const raw = detail?.trim();
  if (!raw) return null;

  // Nombres propios: la plantilla rechazada y la campaña trabada se identifican
  // por su nombre, y traducir un nombre es romperlo.
  if (kind === 'template_rejected' || kind === 'broadcast_stalled') return raw;

  if (kind === 'connection_error') return connectionDetail(raw, t);

  // "sin motivo" lo escribe la propia función SQL cuando el canal falló y no
  // dijo por qué; es la única cadena en español que sale de la base.
  if (/^sin motivo$/i.test(raw)) return t('health.detailNoReason');

  // Primero el código escrito; si no está, la frase que lo delata.
  const code = metaCodeIn(raw) ?? META_TEXTOS.find((m) => m.re.test(raw))?.code ?? null;
  if (code != null) {
    const key = deliveryErrorKey(code);
    if (key) return t(key, { code });
  }

  for (const p of PATTERNS) {
    const m = p.re.exec(raw);
    if (!m) continue;
    return p.param === 'name' && m[1]
      ? t(`health.${p.key}`, { name: m[1].trim() })
      : t(`health.${p.key}`);
  }

  return raw;
}
