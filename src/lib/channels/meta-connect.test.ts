import { describe, expect, it } from 'vitest';
import {
  MetaConnectError,
  isExactMetaAssetMatch,
  metaConnectionConfig,
  selectMetaAccounts,
  selectedAdAccountIds,
} from './meta-connect';

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

describe('metaConnectionConfig', () => {
  it('preserva las cuentas publicitarias al renovar sin pasar por el selector', () => {
    const config = metaConnectionConfig(
      'messenger',
      { page_id: 'page-1' },
      'page-1',
      {}
    );
    expect(config).toEqual({ page_id: 'page-1' });
  });

  it('guarda una elección explícita, incluso si se dejaron todas sin marcar', () => {
    const config = metaConnectionConfig(
      'messenger',
      { page_id: 'page-1' },
      'page-1',
      { 'page-1': [] }
    );
    expect(config).toEqual({ page_id: 'page-1', ad_account_ids: [] });
  });
});

describe('selectMetaAccounts', () => {
  const accounts = [
    {
      channel: 'messenger' as const,
      external_account_id: 'pilar-page',
      page_access_token: 'pilar-token',
      config: { page_id: 'pilar-page' },
      label: 'Pilar Skin',
    },
    {
      channel: 'messenger' as const,
      external_account_id: 'rasmiaw-page',
      page_access_token: 'rasmiaw-token',
      config: { page_id: 'rasmiaw-page' },
      label: 'Rasmiaw',
    },
  ];

  it('persists only the assets selected for this workspace', () => {
    expect(selectMetaAccounts(accounts, ['pilar-page'])).toEqual([accounts[0]]);
  });

  it('rejects the whole renewal when a selected brand is not available', () => {
    expect(() =>
      selectMetaAccounts(accounts, ['pilar-page', 'missing-page'])
    ).toThrow(new MetaConnectError('meta_selected_asset_unavailable'));
  });
});

describe('isExactMetaAssetMatch', () => {
  const instagram = {
    channel: 'instagram' as const,
    external_account_id: 'ig-pilar',
    page_access_token: 'token',
    config: { page_id: 'page-pilar', ig_user_id: 'ig-pilar' },
    label: 'Pilar Skin (Instagram)',
  };

  it('refreshes a matching asset in another workspace without moving it', () => {
    expect(
      isExactMetaAssetMatch(
        {
          id: 'other-workspace-row',
          channel: 'instagram',
          external_account_id: 'ig-pilar',
          config: { page_id: 'page-pilar', ig_user_id: 'ig-pilar' },
          secrets: {},
        },
        instagram
      )
    ).toBe(true);
  });

  it('never matches another brand that shares the same Meta profile', () => {
    expect(
      isExactMetaAssetMatch(
        {
          id: 'rasmiaw-row',
          channel: 'instagram',
          external_account_id: 'ig-rasmiaw',
          config: { page_id: 'page-rasmiaw', ig_user_id: 'ig-rasmiaw' },
          secrets: {},
        },
        instagram
      )
    ).toBe(false);
  });
});
