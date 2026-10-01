import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation',()=>({notFound:()=>{throw new Error('not_found')}}))
vi.mock('@/components/broadcasts/broadcast-builder',()=>({default:()=>null}))
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules()})
describe('reserved campaign editing page',()=>{
 it('is unavailable in the current UI even with a known draft id',async()=>{
  vi.stubEnv('NEXT_PUBLIC_RIVERZ_UI_STAGE','');const {default:Page}=await import('./page')
  await expect(Page({params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})})).rejects.toThrow('not_found')
 })
 it('uses the same builder in a deliberate comparison and rejects invalid identifiers',async()=>{
  vi.stubEnv('NEXT_PUBLIC_RIVERZ_UI_STAGE','comparison');const {default:Page}=await import('./page')
  const id='11111111-1111-4111-8111-111111111111';expect((await Page({params:Promise.resolve({id})})).props).toEqual({draftId:id})
  await expect(Page({params:Promise.resolve({id:'wrong'})})).rejects.toThrow('not_found')
 })
})
