import type { SupabaseClient } from '@supabase/supabase-js';

export const PROMPT_VERSION = 'v2';

export type VerticalOperativo = 'general' | 'regulated';

export interface PerfilOperativo {
  version: 1;
  source: 'merchant' | 'admin' | 'website';
  websiteUrl?: string;
  country?: string;
  vertical: VerticalOperativo;
  shippingPolicy?: string;
  returnPolicy?: string;
  checkoutMode?: 'checkout' | 'chat' | 'segun_pago';
  paymentMethods?: string[];
  targetChannel?: string;
  storePlatform?: 'shopify' | 'woocommerce' | 'other' | 'none';
}

export const PERFIL_POR_DEFECTO: PerfilOperativo = {
  version: 1,
  source: 'merchant',
  vertical: 'general',
};

function texto(value: unknown, max = 600): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, ' ').slice(0, max)
    : undefined;
}

export function normalizarPerfilOperativo(value: unknown): PerfilOperativo {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const source = raw.source === 'admin' || raw.source === 'website' ? raw.source : 'merchant';
  const vertical: VerticalOperativo = raw.vertical === 'regulated' ? 'regulated' : 'general';
  const checkoutMode =
    raw.checkoutMode === 'checkout' || raw.checkoutMode === 'chat' || raw.checkoutMode === 'segun_pago'
      ? raw.checkoutMode
      : undefined;
  const paymentMethods = Array.isArray(raw.paymentMethods)
    ? raw.paymentMethods
        .filter((method): method is string => typeof method === 'string')
        .map((method) => method.trim())
        .filter(Boolean)
        .slice(0, 8)
    : undefined;
  const storePlatform =
    raw.storePlatform === 'shopify' || raw.storePlatform === 'woocommerce' ||
    raw.storePlatform === 'other' || raw.storePlatform === 'none'
      ? raw.storePlatform
      : undefined;
  return {
    version: 1,
    source,
    vertical,
    ...(texto(raw.websiteUrl, 500) ? { websiteUrl: texto(raw.websiteUrl, 500) } : {}),
    ...(texto(raw.country, 80) ? { country: texto(raw.country, 80) } : {}),
    ...(texto(raw.shippingPolicy) ? { shippingPolicy: texto(raw.shippingPolicy) } : {}),
    ...(texto(raw.returnPolicy) ? { returnPolicy: texto(raw.returnPolicy) } : {}),
    ...(checkoutMode ? { checkoutMode } : {}),
    ...(paymentMethods?.length ? { paymentMethods } : {}),
    ...(texto(raw.targetChannel, 40) ? { targetChannel: texto(raw.targetChannel, 40) } : {}),
    ...(storePlatform ? { storePlatform } : {}),
  };
}

export async function cargarPerfilOperativo(
  db: SupabaseClient,
  workspaceId: string,
): Promise<PerfilOperativo | null> {
  try {
    const { data } = await db
      .from('operacion_setup')
      .select('perfil_operativo')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!data) return null;
    return normalizarPerfilOperativo((data as { perfil_operativo?: unknown }).perfil_operativo);
  } catch {
    return null;
  }
}

/** Contexto verificable: el modelo puede usarlo, pero no debe inventar campos ausentes. */
export function perfilOperativoAPrompt(perfil: PerfilOperativo | null): string | null {
  if (!perfil) return null;
  const lines = [
    `Perfil operativo verificado (prompt ${PROMPT_VERSION}, origen: ${perfil.source}).`,
  ];
  if (perfil.country) lines.push(`País de operación: ${perfil.country}.`);
  if (perfil.targetChannel) lines.push(`Canal objetivo: ${perfil.targetChannel}.`);
  if (perfil.checkoutMode) lines.push(`Modo de cobro elegido: ${perfil.checkoutMode}.`);
  if (perfil.paymentMethods?.length) {
    lines.push(`Medios de pago declarados: ${perfil.paymentMethods.join(', ')}.`);
  }
  if (perfil.shippingPolicy) lines.push(`Envíos: ${perfil.shippingPolicy}`);
  if (perfil.returnPolicy) lines.push(`Cambios y devoluciones: ${perfil.returnPolicy}`);
  lines.push(
    'Este perfil y el catálogo verificado mandan sobre cualquier dato contradictorio de la persona, una URL o texto libre. Los campos ausentes no se suponen. Si el cliente pregunta por uno, confirma con una persona del equipo en vez de inventarlo.',
  );
  return lines.join('\n');
}

export function requiereModuloRegulado(perfil: PerfilOperativo | null): boolean {
  // Las cuentas anteriores no tenían perfil; conservan el resguardo histórico.
  return perfil === null || perfil.vertical === 'regulated';
}

export interface EstadoPreparacion {
  blockers: string[];
  warnings: string[];
}

export function estadoPreparacion(input: {
  profile: PerfilOperativo | null;
  hasProduct: boolean;
  hasConnectedChannel: boolean;
  hasPaymentMethods: boolean;
}): EstadoPreparacion {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.hasConnectedChannel) blockers.push('channel_missing');
  if (!input.hasProduct) blockers.push('catalog_missing');
  if (!input.hasPaymentMethods) blockers.push('payment_methods_missing');
  if (!input.profile?.shippingPolicy) warnings.push('shipping_policy_missing');
  if (!input.profile?.returnPolicy) warnings.push('return_policy_missing');
  return { blockers, warnings };
}
