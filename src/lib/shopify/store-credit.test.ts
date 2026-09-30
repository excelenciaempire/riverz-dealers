import { beforeEach,describe,it,expect,vi } from 'vitest'
const m=vi.hoisted(() => ({ graphql:vi.fn() }))
vi.mock('./admin-client',() => ({ ShopifyAdminClient:class { graphql=m.graphql } }))
import { inspectStoreCredit,issueReviewedStoreCredit,prepareStoreCredit } from './store-credit'
const admin={ shopDomain:'test.myshopify.com',accessToken:'test',apiVersion:'2025-10' }, customer='gid://shopify/Customer/22', accountId='gid://shopify/StoreCreditAccount/33'
const transactionId='gid://shopify/StoreCreditAccountCreditTransaction/44', source={ currency:'USD',customer:{ id:22 } }
function account(balance='10.00') { return { id:accountId,balance:{ amount:balance,currencyCode:'USD' },owner:{ __typename:'Customer',id:customer } } }
function current(accounts=[account()]) { return { shop:{ currencyCode:'USD',enabledPresentmentCurrencies:['USD'],customerAccountsV2:{ customerAccountsVersion:'NEW_CUSTOMER_ACCOUNTS' } },
  customer:{ id:customer,displayName:'Ana Rivera',storeCreditAccounts:{ pageInfo:{ hasNextPage:false },nodes:accounts } } } }
function transaction() { return { __typename:'StoreCreditAccountCreditTransaction',id:transactionId,amount:{ amount:'5.25',currencyCode:'USD' },balanceAfterTransaction:{ amount:'15.25',currencyCode:'USD' },createdAt:'2026-09-30T10:00:00Z',expiresAt:null,account:account('20.00') } }
beforeEach(() => {
  m.graphql.mockReset().mockImplementation(async (q:string) => q.includes('query ReviewedCreditAccount') ? current()
    : q.includes('mutation IssueReviewedCredit') ? { storeCreditAccountCredit:{ storeCreditAccountTransaction:{ id:transactionId },userErrors:[] } }
    : q.includes('query ObservedCredit') ? { node:transaction() } : { storeCreditAccount:{ ...account(),transactions:{ pageInfo:{ hasNextPage:false },nodes:[transaction()] } } })
})
async function quote() { const result=await prepareStoreCredit(admin,source,5.25); if (!result.ok) throw Error('invalid fixture'); return result.quote }
describe('reviewed store credit',() => {
  it('prepares without issuing funds and calculates exact amounts in the original currency',async () => {
    expect(await quote()).toMatchObject({ customer_id:customer,customer_name:'Ana Rivera',account_id:accountId,balance:'10.00',amount:'5.25',estimated_balance_after:'15.25',currency:'USD' })
    expect(m.graphql).toHaveBeenCalledTimes(1); expect(m.graphql.mock.calls[0][0]).not.toContain('mutation')
    m.graphql.mockResolvedValue(current([account('10.005')]))
    expect(await prepareStoreCredit(admin,source,5.25)).toMatchObject({ ok:true,quote:{ estimated_balance_after:'15.255' } })
    m.graphql.mockResolvedValue(current([account('99999999999999')]))
    expect(await prepareStoreCredit(admin,source,5.25)).toMatchObject({ ok:false,error:'orderCreditAmountInvalid' })
  })
  it('refuses invalid amounts and an unverified customer without contacting Shopify',async () => {
    for (const amount of [0,-1,NaN,Infinity,0.0000001]) expect(await prepareStoreCredit(admin,source,amount)).toMatchObject({ ok:false,error:'orderCreditAmountInvalid' })
    expect(await prepareStoreCredit(admin,{ currency:'USD',customer:{ id:22.5 } },5)).toMatchObject({ ok:false })
    expect(m.graphql).not.toHaveBeenCalled()
  })
  it('blocks classic accounts, unsupported currency, foreign owners and incomplete account lists',async () => {
    const classic=current(); classic.shop.customerAccountsV2.customerAccountsVersion='CLASSIC'
    const currency=current(); currency.shop.currencyCode='EUR'; currency.shop.enabledPresentmentCurrencies=['EUR']
    const foreign=current(); foreign.customer.storeCreditAccounts.nodes[0].owner.id='gid://shopify/Customer/999'
    const partial=current(); partial.customer.storeCreditAccounts.pageInfo.hasNextPage=true
    for (const data of [classic,currency,foreign,partial]) { m.graphql.mockResolvedValue(data); expect(await prepareStoreCredit(admin,source,5.25)).toMatchObject({ ok:false }) }
    expect(m.graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true)
  })
  it('uses the exact reviewed account and verifies the transaction rather than guessing from its balance',async () => {
    const reviewed=await quote(); m.graphql.mockClear()
    expect(await issueReviewedStoreCredit(admin,source,5.25,reviewed)).toMatchObject({ ok:true,receipt:{ id:transactionId,amount:'5.25',balance_after:'15.25',current_balance:'20.00',expires_at:null } })
    const mutations=m.graphql.mock.calls.filter(([q]) => q.includes('mutation'))
    expect(mutations).toHaveLength(1); expect(mutations[0][1]).toEqual({ id:accountId,input:{ creditAmount:{ amount:'5.25',currencyCode:'USD' },expiresAt:null } })
  })
  it('lets Shopify create a currency account for the verified customer when none existed',async () => {
    m.graphql.mockImplementation(async (q:string) => q.includes('query ReviewedCreditAccount') ? current([])
      : q.includes('mutation IssueReviewedCredit') ? { storeCreditAccountCredit:{ storeCreditAccountTransaction:{ id:transactionId },userErrors:[] } } : { node:transaction() })
    const reviewed=await quote(); expect(reviewed.account_id).toBeNull()
    expect(await issueReviewedStoreCredit(admin,source,5.25,reviewed)).toMatchObject({ ok:true })
    expect(m.graphql.mock.calls.find(([q]) => q.includes('mutation'))![1].id).toBe(customer)
  })
  it('requires another review when the balance or requested amount changed',async () => {
    const reviewed=await quote(); m.graphql.mockResolvedValue(current([account('11.00')]))
    expect(await issueReviewedStoreCredit(admin,source,5.25,reviewed)).toEqual({ ok:false,error:'orderChanged' })
    m.graphql.mockResolvedValue(current())
    expect(await issueReviewedStoreCredit(admin,source,6,reviewed)).toEqual({ ok:false,error:'orderChanged' })
    expect(m.graphql.mock.calls.some(([q]) => q.includes('mutation'))).toBe(false)
  })
  it('keeps wrong amount, currency, owner, type or expiry uncertain with the provider reference',async () => {
    const reviewed=await quote()
    for (const patch of [{ amount:{ amount:'6.25',currencyCode:'USD' } },{ amount:{ amount:'5.25',currencyCode:'EUR' } },{ account:{ ...account(),owner:{ __typename:'Customer',id:'gid://shopify/Customer/999' } } },{ __typename:'StoreCreditAccountDebitTransaction' },{ expiresAt:'2026-10-01T00:00:00Z' }]) {
      m.graphql.mockImplementation(async (q:string) => q.includes('query ReviewedCreditAccount') ? current()
        : q.includes('mutation IssueReviewedCredit') ? { storeCreditAccountCredit:{ storeCreditAccountTransaction:{ id:transactionId },userErrors:[] } } : { node:{ ...transaction(),...patch } })
      expect(await issueReviewedStoreCredit(admin,source,5.25,reviewed)).toMatchObject({ ok:false,uncertain:true,transactionId })
    }
  })
  it('distinguishes known rejection and a lost response without repeating issuance',async () => {
    const reviewed=await quote()
    m.graphql.mockImplementation(async (q:string) => q.includes('query ReviewedCreditAccount') ? current() : { storeCreditAccountCredit:{ storeCreditAccountTransaction:null,userErrors:[{ message:'Rejected' }] } })
    expect(await issueReviewedStoreCredit(admin,source,5.25,reviewed)).toEqual({ ok:false,error:'orderCreditRejected' })
    m.graphql.mockClear().mockImplementation(async (q:string) => { if (q.includes('query ReviewedCreditAccount')) return current(); throw Error('response lost') })
    expect(await issueReviewedStoreCredit(admin,source,5.25,reviewed)).toMatchObject({ ok:false,uncertain:true })
    expect(m.graphql.mock.calls.filter(([q]) => q.includes('mutation'))).toHaveLength(1)
  })
  it('reads a known receipt by ID but never identifies a lost operation from a matching recent amount',async () => {
    expect(await inspectStoreCredit(admin,source,transactionId)).toMatchObject({ receipt:{ id:transactionId,amount:'5.25' },recent_credits:[] })
    expect(await inspectStoreCredit(admin,source)).toMatchObject({ receipt:null,recent_credits:[{ id:transactionId,amount:'5.25' }],more_credits:false })
    m.graphql.mockImplementation(async (q:string) => q.includes('query ReviewedCreditAccount') ? current() : { node:{ ...transaction(),id:'gid://shopify/StoreCreditAccountCreditTransaction/999' } })
    expect(await inspectStoreCredit(admin,source,transactionId)).toBeNull()
  })
})
