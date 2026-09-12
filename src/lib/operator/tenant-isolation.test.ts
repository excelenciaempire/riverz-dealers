import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureThread, loadMessages, loadActions, borrarHilo } from './threads'
import { decideOperatorAction } from './actions'
import { leerCorrida, pedirDetener } from './corridas'
import { cargarPlan, reclamarPlan } from './fleet/plan'
import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'

type Row = Record<string, unknown>
function fixture() {
  const tables: Record<string, Row[]> = {
    operator_threads: [{id:'foreign-thread',workspace_id:'other'}],
    operator_messages: [{id:'secret',thread_id:'foreign-thread',workspace_id:'other',role:'user',content:{text:'other merchant private data'}}],
    operator_actions: [{id:'foreign-action',thread_id:'foreign-thread',workspace_id:'other',status:'propuesto',capability_key:'ajustes.renombrar',args:{nombre:'changed'}}],
    operator_runs: [{id:'foreign-run',thread_id:'foreign-thread',workspace_id:'other',estado:'corriendo',cancelar:false}],
    operator_plans: [{id:'foreign-plan',workspace_id:'other',status:'propuesto'}],
  }
  const writes: string[] = []
  const db = {from(table: string) {
    let selected = [...(tables[table] ?? [])], mutation: Row | 'delete' | undefined
    const finish = () => {
      if (mutation && selected.length) {
        writes.push(table)
        if (mutation !== 'delete') for (const row of selected) Object.assign(row, mutation)
      }
      return {data:selected,error:null}
    }
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (key: string,value: unknown) => {selected=selected.filter(r=>r[key]===value);return q},
      in: (key: string,values: unknown[]) => {selected=selected.filter(r=>values.includes(r[key]));return q},
      update: (patch: Row) => {mutation=patch;return q},
      delete: () => {mutation='delete';return q},
      insert: () => {throw new Error('unexpected_insert')},
      maybeSingle: async () => ({...finish(),data:selected[0]??null}),
      then: (resolve: (value: unknown)=>unknown) => Promise.resolve(finish()).then(resolve),
    }
    return q
  }} as unknown as SupabaseClient
  return {db,tables,writes}
}

describe('Operator tenant isolation with hostile foreign identifiers', () => {
  it('does not expose foreign conversation messages, actions, runs or plans', async () => {
    const {db}=fixture()
    expect(await loadMessages(db,'foreign-thread','own')).toEqual([])
    expect(await loadActions(db,'foreign-thread','own')).toEqual([])
    expect(await leerCorrida(db,'foreign-run','own')).toBeNull()
    expect(await cargarPlan(db,'foreign-plan','own')).toBeNull()
  })
  it('does not replace a foreign thread with a new conversation', async () => {
    const {db}=fixture()
    await expect(ensureThread(db,{threadId:'foreign-thread',workspaceId:'own',userId:'owner',firstText:'read other store'})).rejects.toThrow('operator_thread_unavailable')
  })
  it('cannot approve, reject, stop, claim or delete another merchant records', async () => {
    const {db,tables,writes}=fixture()
    for (const aprobar of [true,false]) expect((await decideOperatorAction(db,{actionId:'foreign-action',workspaceId:'own',userId:'owner',aprobar})).ok).toBe(false)
    await pedirDetener(db,'foreign-run','own')
    expect(await reclamarPlan(db,'foreign-plan','own','owner')).toBe(false)
    expect(await borrarHilo(db,'foreign-thread','own')).toBe(false)
    expect(writes).toEqual([])
    expect(tables.operator_actions[0].status).toBe('propuesto')
    expect(tables.operator_runs[0].cancelar).toBe(false)
  })
  it('never offers account selection, global account listing or arbitrary SQL as a capability', () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(cap.schema.properties,cap.key).not.toHaveProperty('workspace_id')
      expect(cap.schema.properties,cap.key).not.toHaveProperty('workspaceId')
      expect(cap.key).not.toMatch(/^(admin|cuentas|sql)\./)
    }
  })
})
