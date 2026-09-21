import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { ShippingAddressInput } from '@/lib/shopify/create-order';

const PROVIDER = 'google_address_validation';
const ENDPOINT = 'https://addressvalidation.googleapis.com/v1:validateAddress';

type GoogleVerdict = {
  validationGranularity?: string;
  addressComplete?: boolean;
  hasUnconfirmedComponents?: boolean;
  hasInferredComponents?: boolean;
  hasReplacedComponents?: boolean;
  hasSpellCorrectedComponents?: boolean;
  possibleNextAction?: string;
};

type GoogleAddressComponent = {
  componentType?: string;
  confirmationLevel?: string;
};

type GooglePostalAddress = {
  regionCode?: string;
  postalCode?: string;
  administrativeArea?: string;
  locality?: string;
  addressLines?: string[];
};

type GoogleValidationResponse = {
  result?: {
    verdict?: GoogleVerdict;
    address?: {
      formattedAddress?: string;
      postalAddress?: GooglePostalAddress;
      addressComponents?: GoogleAddressComponent[];
      missingComponentTypes?: string[];
      unconfirmedComponentTypes?: string[];
      unresolvedTokens?: string[];
    };
  };
  error?: { message?: string; status?: string };
};

export type AddressValidationDecision =
  | { status: 'disabled'; address: ShippingAddressInput }
  | {
      status: 'accept';
      address: ShippingAddressInput;
      formattedAddress: string;
      responseId?: string;
    }
  | {
      status: 'confirm';
      address: ShippingAddressInput;
      formattedAddress: string;
      reasons: string[];
    }
  | {
      status: 'fix';
      reasons: string[];
      missing: string[];
      suggestedAddress?: ShippingAddressInput;
      formattedAddress?: string;
    }
  | { status: 'unavailable'; reason: string };

const REGION_CODES: Record<string, string> = {
  argentina: 'AR',
  ar: 'AR',
  chile: 'CL',
  cl: 'CL',
  colombia: 'CO',
  co: 'CO',
  españa: 'ES',
  spain: 'ES',
  es: 'ES',
  méxico: 'MX',
  mexico: 'MX',
  mx: 'MX',
  'estados unidos': 'US',
  'united states': 'US',
  usa: 'US',
  us: 'US',
};

const COMPONENT_LABELS: Record<string, string> = {
  street_number: 'número de la dirección',
  route: 'calle o carrera',
  locality: 'ciudad o municipio',
  postal_town: 'ciudad o municipio',
  administrative_area_level_1: 'departamento o provincia',
  country: 'país',
  subpremise: 'apartamento, interior o unidad',
};

const ACCEPTABLE_GRANULARITY = new Set(['SUB_PREMISE', 'PREMISE']);
const IGNORABLE_MISSING = new Set(['postal_code']);

function clean(value: unknown): string | undefined {
  const text =
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text || undefined;
}

function regionCode(country: string | undefined): string | undefined {
  const normalized = clean(country)?.toLocaleLowerCase('es');
  return normalized ? REGION_CODES[normalized] : undefined;
}

function googleRequest(address: ShippingAddressInput) {
  const lines = [clean(address.address1), clean(address.address2)].filter(
    Boolean
  ) as string[];
  return {
    address: {
      ...(regionCode(address.country)
        ? { regionCode: regionCode(address.country) }
        : {}),
      languageCode: 'es',
      ...(clean(address.zip) ? { postalCode: clean(address.zip) } : {}),
      ...(clean(address.province)
        ? { administrativeArea: clean(address.province) }
        : {}),
      ...(clean(address.city) ? { locality: clean(address.city) } : {}),
      addressLines: lines,
    },
  };
}

function normalizedAddress(
  original: ShippingAddressInput,
  postal?: GooglePostalAddress
): ShippingAddressInput {
  const lines = Array.isArray(postal?.addressLines)
    ? (postal.addressLines.map(clean).filter(Boolean) as string[])
    : [];
  return {
    address1: lines[0] ?? clean(original.address1),
    // Google puede validar la calle sin repetir una referencia interna. No la
    // perdemos: para la transportadora el apartamento sigue siendo esencial.
    address2: lines.slice(1).join(', ') || clean(original.address2),
    city: clean(postal?.locality) ?? clean(original.city),
    province: clean(postal?.administrativeArea) ?? clean(original.province),
    zip: clean(postal?.postalCode) ?? clean(original.zip),
    country: clean(original.country) ?? clean(postal?.regionCode),
  };
}

function componentLabel(type: string): string {
  return COMPONENT_LABELS[type] ?? type.replaceAll('_', ' ');
}

/** Llama a Google y convierte su respuesta en aceptar, confirmar o corregir. */
export async function validateGoogleAddress(
  apiKey: string,
  address: ShippingAddressInput
): Promise<AddressValidationDecision> {
  if (!clean(address.address1) || !clean(address.city)) {
    const missing = [
      ...(!clean(address.address1) ? ['calle y número'] : []),
      ...(!clean(address.city) ? ['ciudad o municipio'] : []),
    ];
    return { status: 'fix', reasons: missing, missing };
  }

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(googleRequest(address)),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return { status: 'unavailable', reason: 'network_error' };
  }

  const payload = (await response
    .json()
    .catch(() => ({}))) as GoogleValidationResponse & {
    responseId?: string;
  };
  if (!response.ok || payload.error) {
    return {
      status: 'unavailable',
      reason: payload.error?.status ?? `http_${response.status}`,
    };
  }

  const result = payload.result;
  const verdict = result?.verdict;
  const found = result?.address;
  if (!verdict || !found)
    return { status: 'fix', reasons: ['dirección no encontrada'], missing: [] };

  const suggested = normalizedAddress(address, found.postalAddress);
  const formattedAddress =
    clean(found.formattedAddress) ??
    [
      suggested.address1,
      suggested.address2,
      suggested.city,
      suggested.province,
      suggested.country,
    ]
      .filter(Boolean)
      .join(', ');

  const rawMissing = Array.isArray(found.missingComponentTypes)
    ? found.missingComponentTypes
    : [];
  const missingTypes = rawMissing.filter((type) => {
    if (IGNORABLE_MISSING.has(type)) return false;
    if (type === 'subpremise' && clean(address.address2)) return false;
    return true;
  });
  const suspiciousTypes = (found.addressComponents ?? [])
    .filter(
      (component) =>
        component.confirmationLevel === 'UNCONFIRMED_AND_SUSPICIOUS'
    )
    .map((component) => component.componentType ?? '')
    .filter(Boolean);
  const unresolved = (found.unresolvedTokens ?? [])
    .map(clean)
    .filter(Boolean) as string[];
  const fixReasons = Array.from(
    new Set([
      ...missingTypes.map(componentLabel),
      ...suspiciousTypes.map(componentLabel),
      ...unresolved.map((token) => `dato sin ubicar: ${token}`),
    ])
  );
  const action = verdict.possibleNextAction ?? '';
  const granularity = verdict.validationGranularity ?? 'OTHER';

  if (action === 'FIX' || granularity === 'OTHER' || fixReasons.length > 0) {
    return {
      status: 'fix',
      reasons: fixReasons.length
        ? fixReasons
        : ['dirección no localizada con precisión'],
      missing: missingTypes.map(componentLabel),
      suggestedAddress: suggested,
      formattedAddress,
    };
  }

  const needsSubpremise =
    action === 'CONFIRM_ADD_SUBPREMISES' && !clean(address.address2);
  const strong =
    verdict.addressComplete === true && ACCEPTABLE_GRANULARITY.has(granularity);
  const needsConfirmation =
    needsSubpremise ||
    action === 'CONFIRM' ||
    !strong ||
    verdict.hasUnconfirmedComponents === true;

  if (needsConfirmation) {
    return {
      status: 'confirm',
      address: suggested,
      formattedAddress,
      reasons: needsSubpremise
        ? [
            'falta confirmar si es casa o indicar apartamento, interior o unidad',
          ]
        : ['Google encontró una coincidencia que requiere confirmación'],
    };
  }

  // Una corrección de ortografía o formato con dirección completa a nivel de
  // predio se adopta en silencio. Es justo el caso que no debe generar otra
  // pregunta al cliente.
  return {
    status: 'accept',
    address: suggested,
    formattedAddress,
    responseId: payload.responseId,
  };
}

export async function validateWorkspaceShippingAddress(
  workspaceId: string,
  address: ShippingAddressInput,
  db: SupabaseClient = supabaseAdmin()
): Promise<AddressValidationDecision> {
  const { data, error } = await db
    .from('workspace_integrations')
    .select('api_key_encrypted,is_active')
    .eq('workspace_id', workspaceId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (error || !data || data.is_active !== true)
    return { status: 'disabled', address };
  try {
    const key = decrypt(String(data.api_key_encrypted ?? ''));
    if (!key) return { status: 'unavailable', reason: 'missing_key' };
    return validateGoogleAddress(key, address);
  } catch {
    return { status: 'unavailable', reason: 'invalid_key' };
  }
}

export async function testGoogleAddressValidationKey(
  apiKey: string
): Promise<boolean> {
  const decision = await validateGoogleAddress(apiKey, {
    address1: 'Carrera 7 # 71-21',
    city: 'Bogotá',
    province: 'Bogotá D.C.',
    country: 'Colombia',
  });
  return decision.status !== 'unavailable';
}
