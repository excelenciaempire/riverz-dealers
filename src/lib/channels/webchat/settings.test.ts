import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { updateWebchatSettings } from './settings';
import { upsertWebchatConnection } from './connection-store';

vi.mock('./connection-store', () => ({
  getWebchatConnection: vi.fn(async () => ({ config: {} })),
  webchatConfig: (c: {config: object}) => c.config,
  upsertWebchatConnection: vi.fn(async (_ws, patch) => ({config: patch})),
}));
vi.mock('./domains', () => ({ detectStoreDomains: vi.fn(async () => ['https://shop.test']) }));
beforeEach(() => vi.clearAllMocks());

it('rejects a foreign or deleted agent before saving and scopes the lookup', async () => {
  const eq = vi.fn().mockReturnThis(); const is = vi.fn().mockReturnThis();
  const db = { from: () => ({ select: () => ({eq, is, maybeSingle: async () => ({data:null,error:null})}) }) } as unknown as SupabaseClient;
  await expect(updateWebchatSettings(db, 'own', {agent_id:'foreign'})).rejects.toThrow('agent');
  expect(eq).toHaveBeenCalledWith('workspace_id', 'own');
  expect(is).toHaveBeenCalledWith('deleted_at', null);
  expect(upsertWebchatConnection).not.toHaveBeenCalled();
});
it('normalizes domains, blocks unsafe images and keeps legacy contact settings synchronized', async () => {
  await updateWebchatSettings({} as SupabaseClient, 'own', {allowed_domains:['https://SHOP.test/path','https://shop.test'],avatar_url:'javascript:alert(1)',require_email:true,auto_open_seconds:1});
  expect(upsertWebchatConnection).toHaveBeenCalledWith('own', expect.objectContaining({allowed_domains:['shop.test'],avatar_url:'',require_email:true,require_contact:'email',auto_open_seconds:3}), expect.anything());
});
it('uses store domains when first enabling and lets the new contact option take precedence', async () => {
  await updateWebchatSettings({} as SupabaseClient, 'new', {enabled:true,require_email:true,require_contact:'phone'});
  expect(upsertWebchatConnection).toHaveBeenCalledWith('new', expect.objectContaining({allowed_domains:['https://shop.test'],require_email:false,require_contact:'phone'}), expect.anything());
});
