import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowRunRow } from './types';
const m = vi.hoisted(() => ({ from: vi.fn(), http: vi.fn(), stop: vi.fn(), send: vi.fn(), owner: vi.fn() }));
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({ from: m.from }) }));
vi.mock('./http-node', () => ({ runHttpFlowNode: m.http, failHttpFlowNode: m.stop }));
vi.mock('@/lib/workspaces/owner', () => ({ resolveWorkspaceOwnerUserId: m.owner }));
vi.mock('./meta-send', () => Object.fromEntries(['engineSendCtaUrl','engineSendDocument','engineSendImage',
  'engineSendInteractiveButtons','engineSendInteractiveList','engineSendText','engineSendVideo'].map(name => [name,m.send])));
import { dispatchInboundToFlows } from './engine';
let run: FlowRunRow;
let events: Record<string, unknown>[], writes: Record<string, unknown>[];
beforeEach(() => {
  vi.clearAllMocks(); events = []; writes = [];
  run = { id:'run',workspace_id:'workspace',flow_id:'flow',contact_id:'contact',conversation_id:'conversation',
    status:'active',current_node_key:'lookup',vars:{order:'123'},last_advanced_at:'2026-10-01T00:00:00Z',
    started_at:'2026-10-01T00:00:00Z',ended_at:null,end_reason:null,call_stack:[],reprompt_count:0,last_prompt_message_id:null };
  m.owner.mockResolvedValue('owner'); m.stop.mockResolvedValue(false); m.http.mockResolvedValue({state:'pending'});
  m.from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select','eq','is','filter','in','order','limit']) q[method] = () => q;
    q.insert = (value: Record<string, unknown>) => { if (table === 'flow_run_events') events.push(value); return q; };
    q.update = (value: Record<string, unknown>) => { if (table === 'flow_runs') writes.push(value); return q; };
    const result = () => ({error:null,count:0,data:table === 'flow_runs' ? [run] : table === 'flow_nodes' ? [
      {flow_id:'flow',node_key:'lookup',node_type:'http_action',config:{}},
      {flow_id:'flow',node_key:'end',node_type:'end',config:{}},
    ] : []});
    q.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve,reject);
    return q;
  });
});
const dispatch = () => dispatchInboundToFlows({userId:'owner',contactId:'contact',conversationId:'conversation',
  isFirstInboundMessage:false,message:{kind:'text',text:'Are you there?',meta_message_id:'inbound'}});
describe('HTTP receipts through the actual inbound flow dispatcher', () => {
  it.each(['pending','superseded'])('consumes a reply during %s without fallback or another customer prompt', async state => {
    m.http.mockResolvedValue({state});
    expect(await dispatch()).toMatchObject({consumed:true,outcome:'advanced'});
    expect(m.http).toHaveBeenCalledTimes(1); expect(m.send).not.toHaveBeenCalled(); expect(writes).toEqual([]);
    expect(events.some(event => event.event_type === 'fallback_fired')).toBe(false);
  });
  it('continues after a durable receipt and records that it was replayed', async () => {
    m.http.mockResolvedValue({state:'advanced',next:'end',vars:{order:'123',system_status:'received'},
      visitAt:run.last_advanced_at,receiptId:'receipt',replayed:true});
    expect(await dispatch()).toMatchObject({consumed:true,outcome:'completed'});
    expect(events).toContainEqual(expect.objectContaining({event_type:'node_entered',payload:expect.objectContaining({receipt_replayed:true,business_completion_verified:false})}));
    expect(writes).toContainEqual(expect.objectContaining({status:'completed'})); expect(m.send).not.toHaveBeenCalled();
  });
  it.each([true,false])('uses conditional failure instead of terminating another worker: stopped=%s', async stopped => {
    const error = new Error('review_required'); m.http.mockRejectedValue(error); m.stop.mockResolvedValue(stopped);
    expect(await dispatch()).toMatchObject({consumed:true,outcome:stopped?'completed':'advanced'});
    expect(m.stop).toHaveBeenCalledWith(expect.anything(),run,expect.objectContaining({node_key:'lookup'}),error);
    expect(writes).toEqual([]); expect(m.send).not.toHaveBeenCalled();
  });
});
