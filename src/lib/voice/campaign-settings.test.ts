import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createVoiceCampaign, changeVoiceCampaignStatus } from './campaign-settings';

function database(missing?: string) {
  const filters: unknown[][] = []; const insert = vi.fn().mockReturnThis();
  const db = { from: (table: string) => {
    const q = { select: () => q, insert, update: () => q, eq: (k: string,v: unknown) => {filters.push([table,k,v]);return q;},
      is: (k: string,v: unknown) => {filters.push([table,k,v]);return q;},
      in: (k: string,v: unknown) => {filters.push([table,k,v]);return q;},
      maybeSingle: async () => ({data:table===missing?null:{id:'id'},error:null}),
      single: async () => ({data:{id:'new'},error:null}) };
    insert.mockImplementation(() => q); return q;
  }} as unknown as SupabaseClient;
  return {db,filters,insert};
}
const input = {name:'Follow-up',agent_id:'agent',segment_id:'segment'};
it.each(['ai_agents','contact_segments'])('rejects a missing/foreign %s before inserting', async (table) => {
  const {db,filters,insert} = database(table);
  await expect(createVoiceCampaign(db,'own',input)).rejects.toThrow('invalid_campaign_resources');
  expect(filters).toContainEqual([table,'workspace_id','own']); expect(insert).not.toHaveBeenCalled();
});
it.each([{call_type:'inbound'},{start:'true'},{name:3},{objective:[]}])('rejects malformed campaigns: %j', async patch => {
  const {db,insert} = database();
  await expect(createVoiceCampaign(db,'own',{...input,...patch})).rejects.toThrow('invalid_campaign'); expect(insert).not.toHaveBeenCalled();
});
it('creates a draft by default', async () => {
  const {db,insert}=database(); await createVoiceCampaign(db,'own',input);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({workspace_id:'own',status:'draft'}));
});
it('does not report success for a missing or terminal campaign', async () => {
  const {db,filters}=database('voice_campaigns');
  await expect(changeVoiceCampaignStatus(db,'own','other','running')).rejects.toThrow('campaign_unavailable');
  expect(filters).toContainEqual(['voice_campaigns','workspace_id','own']);
  expect(filters).toContainEqual(['voice_campaigns','status',['draft','running','paused']]);
});
