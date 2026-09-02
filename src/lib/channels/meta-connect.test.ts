import { describe, expect, it } from 'vitest';
import { selectedAdAccountIds } from './meta-connect';

describe('selectedAdAccountIds', () => {
  it('persiste sólo las cuentas elegidas para la página de esa conexión', () => {
    const selected = {
      'page-1': ['act_101', 'act_101', 'not-an-account'],
      'page-2': ['act_202'],
    };
    expect(selectedAdAccountIds(selected, 'page-1')).toEqual(['act_101']);
    expect(selectedAdAccountIds(selected, 'page-2')).toEqual(['act_202']);
  });
});
