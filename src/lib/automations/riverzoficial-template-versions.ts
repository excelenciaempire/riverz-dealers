export const RIVERZOFICIAL_PRODUCT_TEMPLATE_VERSIONS = {
  confirmacion: 2,
  recordatorio: 3,
  revision: 3,
  carrito: 3,
  carrito_recordatorio: 3,
  despachado: 2,
  entregado: 2,
  cancelado: 2,
  compra_pagada: 2,
  experiencia: 2,
  revision_pago: 2,
} as const;

export type RiverzoficialProductTemplateKey =
  keyof typeof RIVERZOFICIAL_PRODUCT_TEMPLATE_VERSIONS;

export function riverzoficialProductTemplateName(
  key: RiverzoficialProductTemplateKey,
): string {
  return `deuna_${key}_producto_v${RIVERZOFICIAL_PRODUCT_TEMPLATE_VERSIONS[key]}`;
}

export function riverzoficialProductTemplateKey(
  name: string,
): RiverzoficialProductTemplateKey | null {
  for (const key of Object.keys(
    RIVERZOFICIAL_PRODUCT_TEMPLATE_VERSIONS,
  ) as RiverzoficialProductTemplateKey[]) {
    if (new RegExp(`^deuna_${key}_producto_v\\d+$`).test(name)) return key;
  }
  return null;
}
