import { afterEach,describe,expect,it,vi } from 'vitest'
import { nativeBlocked,setNativeBlocked } from './native-block'
const account={ phoneNumberId:'123456789',accessToken:'private-token',recipient:'16505551234' }
afterEach(() => vi.unstubAllGlobals())
const response=(body:unknown,status=200) => new Response(JSON.stringify(body),{ status })
describe('verified native WhatsApp block',() => {
  it('uses the exact phone account and reads the real blocked identity',async() => {
    const fetcher=vi.fn().mockResolvedValue(response({ data:[{ messaging_product:'whatsapp',wa_id:account.recipient }] }));vi.stubGlobal('fetch',fetcher)
    expect(await nativeBlocked(account)).toBe(true);expect(String(fetcher.mock.calls[0][0])).toContain('/v22.0/123456789/block_users')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers:{ Authorization:'Bearer private-token' },redirect:'error',cache:'no-store' })
  })
  it('paginates only the fixed Graph origin, preserving absence only on the final page',async() => {
    const fetcher=vi.fn().mockResolvedValueOnce(response({ data:[],paging:{ next:'https://attacker.example/steal',cursors:{ after:'cursor' } } })).mockResolvedValueOnce(response({ data:[],paging:{ cursors:{ after:'end' } } }));vi.stubGlobal('fetch',fetcher)
    expect(await nativeBlocked(account)).toBe(false);expect(new URL(fetcher.mock.calls[1][0]).origin).toBe('https://graph.facebook.com');expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('after')).toBe('cursor')
  })
  it('does not infer unblocked from malformed or incomplete pages',async() => {
    for (const body of [{ data:[{ user_id:'unknown-format' }] },{ data:[],paging:{ next:'next' } },{}]) {
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(body)));await expect(nativeBlocked(account)).rejects.toMatchObject({ code:'block_unavailable' })
    }
  })
  it('requires an exact per-user receipt for block and unblock',async() => {
    for (const blocked of [true,false]) {
      const fetcher=vi.fn().mockResolvedValue(response({ messaging_product:'whatsapp',block_users:{ [blocked ? 'added_users' : 'removed_users']:[{ input:`+${account.recipient}`,wa_id:account.recipient }] } }));vi.stubGlobal('fetch',fetcher)
      expect(await setNativeBlocked(account,blocked)).toEqual({ blocked,recipient:account.recipient })
      expect(fetcher.mock.calls[0][1].method).toBe(blocked ? 'POST' : 'DELETE');expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ messaging_product:'whatsapp',block_users:[{ user:'+16505551234' }] })
    }
  })
  it('never accepts HTTP success, another user or a mixed receipt as verified completion',async() => {
    for (const body of [{ success:true },{ messaging_product:'whatsapp',block_users:{ added_users:[{ input:'+16505559999',wa_id:'16505559999' }] } },{ messaging_product:'whatsapp',block_users:{ added_users:[] } }]) {
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(body)));await expect(setNativeBlocked(account,true)).rejects.toMatchObject({ code:'block_uncertain' })
    }
  })
  it('does not retry network loss or a server error',async() => {
    for (const fetcher of [vi.fn().mockRejectedValue(new Error('lost')),vi.fn().mockResolvedValue(response({ error:{ code:1 } },500))]) {
      vi.stubGlobal('fetch',fetcher);await expect(setNativeBlocked(account,true)).rejects.toMatchObject({ code:'block_uncertain' });expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  it('distinguishes explicit rejection without exposing provider error text or credentials',async() => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({ error:{ message:'private-token',code:100 } },400)))
    await expect(setNativeBlocked(account,true)).rejects.toMatchObject({ message:'block_rejected',providerCode:100 })
  })
})
