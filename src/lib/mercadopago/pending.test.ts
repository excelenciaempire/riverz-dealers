import { afterEach, describe, expect, it, vi } from 'vitest'
import { isActionablePending, pendingPhone, paymentInstructionsUrl, ingestPendingPayments } from './pending'
import { fetchPayment, type MpPayment } from './client'
import { getTemplate } from '@/lib/automations/templates'
import { sessionRunId } from '@/lib/automations/session-template'

const cash: MpPayment = { id: 123, status: 'pending', status_detail: 'pending_waiting_payment',
  payment_type_id: 'ticket', payment_method_id: 'efecty', transaction_amount: 100,
  date_created: '2026-09-27T00:00:00Z', live_mode: true }
afterEach(() => vi.unstubAllGlobals())
describe('Mercado Pago pending payments', () => {
  it.each(['ticket','atm','bank_transfer'])('detects actionable %s payments', payment_type_id => {
    expect(isActionablePending({ ...cash, payment_type_id })).toBe(true)
  })
  it('detects PSE waiting for the buyer to transfer', () => {
    expect(isActionablePending({ ...cash, payment_type_id: 'bank_transfer', status_detail: 'pending_waiting_transfer' })).toBe(true)
  })
  it.each([
    ['CO', 'efecty', 'ticket', 'pending_waiting_payment', 'COP'],
    ['CO', 'pse', 'bank_transfer', 'pending_waiting_transfer', 'COP'],
    ['MX', 'oxxo', 'ticket', 'pending_waiting_payment', 'MXN'],
    ['MX', 'paycash', 'ticket', 'pending_waiting_payment', 'MXN'],
    ['MX', 'spei', 'bank_transfer', 'pending_waiting_transfer', 'MXN'],
    ['AR', 'rapipago', 'ticket', 'pending_waiting_payment', 'ARS'],
    ['AR', 'pagofacil', 'ticket', 'pending_waiting_payment', 'ARS'],
    ['BR', 'bolbradesco', 'ticket', 'pending_waiting_payment', 'BRL'],
    ['BR', 'pix', 'bank_transfer', 'pending_waiting_transfer', 'BRL'],
    ['PE', 'pagoefectivo_atm', 'atm', 'pending_waiting_payment', 'PEN'],
    ['UY', 'abitab', 'ticket', 'pending_waiting_payment', 'UYU'],
    ['UY', 'redpagos', 'ticket', 'pending_waiting_payment', 'UYU'],
    ['CL', 'local_transfer', 'bank_transfer', 'pending_waiting_transfer', 'CLP'],
    ['future', 'new_provider_method', 'ticket', 'pending_waiting_payment', 'COP'],
  ])('recognizes %s / %s by provider state and type, not a country or method whitelist',
    (_country, payment_method_id, payment_type_id, status_detail, currency_id) => {
      const payment = { ...cash, payment_method_id, payment_type_id, status_detail, currency_id }
      expect(isActionablePending(payment)).toBe(true)
      expect(isActionablePending({ ...payment, status: 'approved' })).toBe(false)
      expect(isActionablePending({ ...payment, date_of_expiration: '2020-01-01' })).toBe(false)
    })
  it('resolves the Pix ticket URL without inventing another payment', () => {
    const pix: MpPayment = { ...cash, payment_method_id: 'pix', payment_type_id: 'bank_transfer',
      status_detail: 'pending_waiting_transfer', point_of_interaction: {
        transaction_data: { ticket_url: 'https://www.mercadopago.com.br/payments/123/ticket' } } }
    expect(paymentInstructionsUrl(pix)).toBe('https://www.mercadopago.com.br/payments/123/ticket')
    expect(paymentInstructionsUrl({ ...pix, point_of_interaction: {
      transaction_data: { ticket_url: 'javascript:alert(1)' } } })).toBeNull()
  })
  it.each(['approved','rejected','cancelled','refunded','in_process','authorized'])('never reminds status %s', status => {
    expect(isActionablePending({ ...cash, status })).toBe(false)
  })
  it.each(['pending_review_manual','pending_contingency','pending_challenge',''])('does not treat %s as an unpaid voucher', status_detail => {
    expect(isActionablePending({ ...cash, status_detail })).toBe(false)
  })
  it('excludes card processing, test payments, expired vouchers and zero amounts', () => {
    for (const change of [{ payment_type_id: 'credit_card' }, { live_mode: false },
      { date_of_expiration: '2020-01-01' }, { date_of_expiration: 'bad-date' }, { transaction_amount: 0 }]) {
      expect(isActionablePending({ ...cash, ...change })).toBe(false)
    }
  })
  it('keeps only HTTPS instructions, never generates a replacement charge', () => {
    expect(paymentInstructionsUrl({ ...cash, transaction_details: { external_resource_url: 'https://payments.example/voucher/123' } })).toBe('https://payments.example/voucher/123')
    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com'])
      expect(paymentInstructionsUrl({ ...cash, transaction_details: { external_resource_url: url } })).toBeNull()
  })
  it('uses exact, unambiguous identity rather than names', () => {
    const payment = { ...cash, payer: { email: 'ana@example.com', first_name: 'Ana' } }
    expect(pendingPhone(payment, [{ email: 'ana@example.com', phone: '+573001234567' }], 'CO')).toBe('573001234567')
    expect(pendingPhone(payment, [{ email: 'other@example.com', phone: '+573001234567' }], 'CO')).toBeNull()
    expect(pendingPhone(payment, [{ email: 'ana@example.com', phone: '+573001234567' },
      { email: 'ana@example.com', phone: '+573001234568' }], 'CO')).toBeNull()
    expect(pendingPhone({ ...cash, payer: { phone: { area_code: '300', number: '1234567' } } }, [], 'CO')).toBe('573001234567')
  })
  it('deduplicates source records and never upserts dispatch state', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const db = { from: vi.fn(() => ({ upsert })) } as never
    await ingestPendingPayments(db, 'ws', [cash, cash], 'CO')
    expect(upsert).toHaveBeenCalledTimes(1)
    const rows = upsert.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('dispatched_at')
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'workspace_id,mp_payment_id' })
  })
  it('reads current status without cache and refuses mismatched identities', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => cash })
    vi.stubGlobal('fetch', request)
    expect((await fetchPayment('test-token', '123')).status).toBe('pending')
    expect(request.mock.calls[0][1].cache).toBe('no-store')
    await expect(fetchPayment('test-token', '124')).rejects.toThrow('identity mismatch')
    await expect(fetchPayment('test-token', '../123')).rejects.toThrow('invalid')
  })
  it('never guesses a phone from a truncated contact match list', async () => {
    const upsert = vi.fn().mockResolvedValue({error:null})
    const contacts = { select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
      in:vi.fn().mockResolvedValue({data:[{email:'ana@example.com',phone:'+573001234567'}],count:2,error:null}) }
    const db={from:(table:string)=>table==='contacts'?contacts:{upsert}} as never
    await ingestPendingPayments(db,'ws',[{...cash,payer:{email:'ana@example.com'}}],'CO')
    expect(upsert.mock.calls[0][0][0].phone).toBeNull()
    contacts.in.mockResolvedValueOnce({data:[{email:'ana@example.com',phone:'+573001234567'}],count:1,error:null})
    await ingestPendingPayments(db,'ws',[{...cash,payer:{email:'ana@example.com'}}],'CO')
    expect(upsert.mock.calls[1][0][0].phone).toBe('573001234567')
  })
  it('batches large syncs so URL and request limits cannot break existing rejected-payment sync', async () => {
    const upsert=vi.fn().mockResolvedValue({error:null})
    const query={update:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),in:vi.fn().mockResolvedValue({error:null}),upsert}
    const db={from:()=>query} as never
    await ingestPendingPayments(db,'ws',Array.from({length:251},(_,id)=>({...cash,id})),'CO')
    expect(upsert.mock.calls.map(call=>call[0].length)).toEqual([200,51])
    await ingestPendingPayments(db,'ws',Array.from({length:301},(_,id)=>({...cash,id,status:'approved'})),'CO')
    expect(query.in.mock.calls.map(call=>call[1].length)).toEqual([100,100,100,1])
  })
  it('keeps the same execution across webhook/cron replays and status changes', () => {
    const original = sessionRunId('ws','flow','payment_pending','buyer',{ payment_id: '123' })
    expect(sessionRunId('ws','flow','payment_pending','buyer',{ payment_id: '123', financial_status: 'approved' })).toBe(original)
    expect(sessionRunId('ws','flow','payment_pending','buyer',{ payment_id: '124' })).not.toBe(original)
  })
  it('provides an inactive-by-install recipe with three paid checks and bilingual copy', () => {
    const recipe = getTemplate('pago-pendiente-mercadopago')!
    expect(recipe.trigger_type).toBe('payment_pending')
    expect(recipe.requiresGateway).toBe('mercadopago')
    expect(recipe.steps.filter(s => s.step_type === 'wait').map(s => (s.step_config as {from_trigger_hours:number}).from_trigger_hours)).toEqual([1,6,24])
    expect(recipe.steps.filter(s => s.step_type === 'send_template').map(s => (s.step_config as {expires_after_hours:number}).expires_after_hours)).toEqual([6,24,26])
    expect(recipe.steps.filter(s => s.step_type === 'condition').map(s => s.step_config)).toEqual(Array(3).fill({ subject: 'order_paid', value: 'false' }))
    expect(getTemplate(recipe.slug,'en')!.suggested_template_body).toContain('voucher')
    expect(getTemplate(recipe.slug,'en')!.steps.filter(s => s.step_type === 'send_template').every(s => (s.step_config as {language:string}).language === 'en')).toBe(true)
  })
})
