import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RIVERZOFICIAL_WORKSPACE } from './riverzoficial-template-context';
import { promoteApprovedRiverzoficialTemplate } from './riverzoficial-template-promotion';

describe('Riverz Oficial template promotion', () => {
  it('replaces the approved product version and rebuilds its variables', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    });
    const from = vi.fn((table: string) => {
      if (table === 'message_templates') {
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              status: 'Approved',
              variable_fields: { '1': 'order_items', '2': 'tracking_number' },
            },
            error: null,
          }),
        };
        query.select.mockReturnValue(query);
        query.eq.mockReturnValue(query);
        return query;
      }
      if (table === 'automations') {
        const terminal = Promise.resolve({ data: [{ id: 'flow-1' }], error: null });
        const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn().mockReturnValue(terminal) };
        query.select.mockReturnValue(query);
        query.eq.mockReturnValue(query);
        return query;
      }
      const readTerminal = Promise.resolve({
        data: [
          {
            id: 'step-1',
            automation_id: 'flow-1',
            step_config: {
              template_name: 'deuna_despachado_producto_v1',
              language: 'es',
              variables: { '1': '{{vars.old}}' },
            },
          },
        ],
        error: null,
      });
      const query = {
        select: vi.fn(),
        in: vi.fn(),
        eq: vi.fn().mockReturnValue(readTerminal),
        update,
      };
      query.select.mockReturnValue(query);
      query.in.mockReturnValue(query);
      return query;
    });

    const promoted = await promoteApprovedRiverzoficialTemplate(
      { from } as unknown as SupabaseClient,
      RIVERZOFICIAL_WORKSPACE,
      'deuna_despachado_producto_v2',
      'es',
    );

    expect(promoted).toBe(1);
    expect(update).toHaveBeenCalledWith({
      step_config: {
        template_name: 'deuna_despachado_producto_v2',
        language: 'es',
        variables: {
          '1': '{{vars.order_items}}',
          '2': '{{vars.tracking_number}}',
        },
      },
    });
  });
});
