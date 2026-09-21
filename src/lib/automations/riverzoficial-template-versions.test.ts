import { describe, expect, it } from 'vitest';
import {
  riverzoficialProductTemplateKey,
  riverzoficialProductTemplateName,
} from './riverzoficial-template-versions';

describe('Riverz Oficial template versions', () => {
  it('identifies old product versions and resolves the current replacement', () => {
    expect(riverzoficialProductTemplateKey('deuna_despachado_producto_v1')).toBe(
      'despachado',
    );
    expect(riverzoficialProductTemplateName('despachado')).toBe(
      'deuna_despachado_producto_v2',
    );
  });

  it('ignores templates outside the product sequence', () => {
    expect(riverzoficialProductTemplateKey('deuna_pedido_despachado_v2')).toBeNull();
  });

  it('includes the paid-order confirmation used by active flows', () => {
    expect(riverzoficialProductTemplateKey('deuna_compra_pagada_producto_v1')).toBe(
      'compra_pagada',
    );
    expect(riverzoficialProductTemplateName('compra_pagada')).toBe(
      'deuna_compra_pagada_producto_v2',
    );
  });
});
