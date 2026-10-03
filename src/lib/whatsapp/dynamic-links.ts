/**
 * Botones URL DINÁMICOS de plantillas — links variables por cliente.
 *
 * Meta solo permite en un botón URL una variable al FINAL y con dominio FIJO
 * (`https://dominio/{{1}}`). Para dar a cada cliente su propio link (carrito
 * abandonado, estado del pedido, tracking...) el botón apunta siempre a nuestro
 * redirector `${SITE}/r/{{1}}`; al enviar, `{{1}}` se llena con un token corto
 * que redirige al link real de ese cliente (ver `lib/links/short-link.ts`).
 *
 * Este módulo es PURO (sin acceso a red/DB) para poder usarse tanto en el
 * cliente (editor + preview) como en el servidor (crear/enviar plantilla).
 */

/** Qué link representa un botón dinámico. El editor lo guarda en la
 *  plantilla; al enviar, el motor lo resuelve desde el contexto del disparador. */
export type ButtonUrlVariable =
  | 'abandoned_checkout'
  | 'order_status'
  | 'tracking'
  | 'payment'
  | 'product';

import { isDealerDeployment } from '@/lib/dealers/config';

export const BUTTON_URL_VARIABLES: ButtonUrlVariable[] = isDealerDeployment() ? [] : [
  'abandoned_checkout',
  'order_status',
  'tracking',
  'payment',
  'product',
];

export function isButtonUrlVariable(x: unknown): x is ButtonUrlVariable {
  return typeof x === 'string' && (BUTTON_URL_VARIABLES as string[]).includes(x);
}

/**
 * Dominio público del CRM (mismo que sirve el redirector `/r/:token`). Meta
 * exige que los botones URL sean https y con dominio real, así que NO se usa
 * NEXT_PUBLIC_SITE_URL cuando apunta a localhost o http (config de desarrollo):
 * en ese caso el botón dinámico saldría con un dominio inválido y Meta
 * rechazaría la plantilla. Se cae a riverz.co, que es el dominio del CRM.
 */
const SITE_BASE = (() => {
  const env = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(env) && !/localhost|127\.0\.0\.1/i.test(env)) return env;
  return 'https://riverz.co';
})();

/** URL que se manda a Meta como base del botón: dominio fijo + `{{1}}`. */
export function dynamicButtonTemplateUrl(): string {
  return `${SITE_BASE}/r/{{1}}`;
}

/** Ejemplo de URL completa que Meta exige en `example` del botón dinámico. */
export function dynamicButtonExampleUrl(): string {
  return `${SITE_BASE}/r/ex1a2b3c`;
}

/** URL pública final de un token de short link. */
export function shortLinkPublicUrl(token: string): string {
  return `${SITE_BASE}/r/${token}`;
}

/**
 * Claves de contexto (context.vars del disparador) que alimentan cada tipo de
 * link. Se aceptan varios alias porque distintos disparadores nombran el mismo
 * dato distinto (p. ej. el cron de carritos usa `checkout_url`, un flujo usa
 * `abandoned_checkout_url`).
 */
const VAR_KEYS: Record<ButtonUrlVariable, string[]> = {
  abandoned_checkout: ['checkout_url', 'abandoned_checkout_url'],
  order_status: ['order_status_url'],
  tracking: ['tracking_url', 'order_tracking_url'],
  payment: ['payment_url'],
  product: ['product_url'],
};

/** Resuelve la URL real de un botón dinámico desde las variables del contexto. */
export function resolveButtonUrlFromVars(
  v: ButtonUrlVariable,
  vars: Record<string, unknown> | undefined | null,
): string | null {
  if (!vars) return null;
  for (const k of VAR_KEYS[v]) {
    const val = vars[k];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return null;
}
