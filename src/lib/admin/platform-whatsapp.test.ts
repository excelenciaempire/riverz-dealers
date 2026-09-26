import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: vi.fn() }));

import { paramSeguro } from './platform-whatsapp';

describe('paramSeguro', () => {
  it('joins bulleted lines with a single separator', () => {
    expect(paramSeguro('· Trabajo con errores: a\n· Trabajo con errores: b'))
      .toBe('Trabajo con errores: a · Trabajo con errores: b');
    expect(paramSeguro('· Conexión con error: ig_comment')).toBe('Conexión con error: ig_comment');
  });
});
