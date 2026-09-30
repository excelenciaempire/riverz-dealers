import 'server-only'
import { createHash } from 'node:crypto'
import { ShopifyAdminClient } from './admin-client'
import type { ShopifyAdmin } from './order-tags'
import { refundMoney,refundMoneyText } from './refund-plan'
export const STORE_CREDIT_SCOPES=['read_store_credit_accounts','read_store_credit_account_transactions','write_store_credit_account_transactions']
interface Money { amount:string; currencyCode:string }
interface Account { id:string; balance:Money; owner:{ __typename:string; id?:string } }
interface CreditTransaction { __typename:string; id:string; amount:Money; balanceAfterTransaction:Money; createdAt:string; expiresAt:string | null; account:Account }
export interface StoreCreditSource { currency:string; customer?:{ id:string | number } | null }
export interface StoreCreditAccountState { customer_id:string; customer_name:string; account_id:string | null; balance:string; currency:string; accounts_version:string }
export interface StoreCreditQuote extends StoreCreditAccountState { fingerprint:string; amount:string; estimated_balance_after:string }
export interface StoreCreditReceipt { id:string; customer_id:string; account_id:string; amount:string; currency:string; balance_after:string; current_balance:string; created_at:string; expires_at:string | null }
export interface ObservedStoreCredit extends StoreCreditAccountState { receipt:StoreCreditReceipt | null; recent_credits:StoreCreditReceipt[]; more_credits:boolean }
const ACCOUNT='id balance{amount currencyCode} owner{__typename ... on Customer{id}}'
const CREDIT=`__typename ... on StoreCreditAccountCreditTransaction{id amount{amount currencyCode} balanceAfterTransaction{amount currencyCode} createdAt expiresAt account{${ACCOUNT}}}`
const CREDIT_ID=/^gid:\/\/shopify\/StoreCreditAccount(?:Credit)?Transaction\/\d{1,20}$/
function client(admin:ShopifyAdmin) { return new ShopifyAdminClient(admin.shopDomain,admin.accessToken,admin.apiVersion,30000) }
function customerId(source:StoreCreditSource):string | null {
  const id=source.customer?.id
  return (typeof id==='string' || typeof id==='number' && Number.isSafeInteger(id)) && /^\d{1,20}$/.test(String(id)) ? `gid://shopify/Customer/${id}` : null
}
function money(raw:Money | undefined,currency:string):raw is Money {
  return !!raw && raw.currencyCode===currency && typeof raw.amount==='string' && refundMoney(raw.amount)!==null && refundMoney(Number(raw.amount))===refundMoney(raw.amount)
}
function account(raw:Account,id:string,currency:string):boolean {
  return !!raw && /^gid:\/\/shopify\/StoreCreditAccount\/\d{1,20}$/.test(raw.id) && raw.owner?.__typename==='Customer' && raw.owner.id===id && money(raw.balance,currency)
}
async function readAccount(admin:ShopifyAdmin,source:StoreCreditSource) {
  const id=customerId(source)
  if (!id || !/^[A-Z]{3}$/.test(source.currency)) return null
  const data=await client(admin).graphql<{ shop:{ currencyCode:string; enabledPresentmentCurrencies:string[]; customerAccountsV2:{ customerAccountsVersion:string } };
    customer?:{ id:string; displayName:string; storeCreditAccounts:{ pageInfo:{ hasNextPage:boolean }; nodes:Account[] } } | null }>(
    `query ReviewedCreditAccount($id:ID!){shop{currencyCode enabledPresentmentCurrencies customerAccountsV2{customerAccountsVersion}} customer(id:$id){id displayName storeCreditAccounts(first:100){pageInfo{hasNextPage} nodes{${ACCOUNT}}}}}`,{ id })
  const customer=data.customer
  if (!customer || customer.id!==id || typeof customer.displayName!=='string' || customer.storeCreditAccounts?.pageInfo?.hasNextPage!==false ||
    !Array.isArray(customer.storeCreditAccounts.nodes) || customer.storeCreditAccounts.nodes.length>100 || !Array.isArray(data.shop?.enabledPresentmentCurrencies) || typeof data.shop.customerAccountsV2?.customerAccountsVersion!=='string' ||
    customer.storeCreditAccounts.nodes.some(item => !/^[A-Z]{3}$/.test(item.balance?.currencyCode ?? '') || !account(item,id,item.balance.currencyCode))) return null
  const matches=customer.storeCreditAccounts.nodes.filter(item => item.balance?.currencyCode===source.currency)
  if (matches.length>1 || matches.some(item => !account(item,id,source.currency))) return null
  const found=matches[0]
  const state:StoreCreditAccountState={ customer_id:id,customer_name:customer.displayName,account_id:found?.id ?? null,balance:found?.balance.amount ?? '0.00',
    currency:source.currency,accounts_version:data.shop.customerAccountsV2.customerAccountsVersion }
  return { state,compatible:state.accounts_version==='NEW_CUSTOMER_ACCOUNTS' && [data.shop.currencyCode,...data.shop.enabledPresentmentCurrencies].includes(source.currency) }
}
export async function prepareStoreCredit(admin:ShopifyAdmin,source:StoreCreditSource,amount:number) {
  const units=refundMoney(amount)
  if (units===null || units<=BigInt(0)) return { ok:false as const,error:'orderCreditAmountInvalid' }
  try {
    const current=await readAccount(admin,source)
    if (!current) return { ok:false as const,error:'orderCreditUnavailable' }
    if (!current.compatible) return { ok:false as const,error:'orderCreditIncompatible' }
    const afterUnits=refundMoney(current.state.balance)!+units, after=refundMoneyText(afterUnits)
    if (refundMoney(after)===null || refundMoney(Number(after))!==afterUnits) return { ok:false as const,error:'orderCreditAmountInvalid' }
    const quote:StoreCreditQuote={ ...current.state,fingerprint:createHash('sha256').update(JSON.stringify(current.state)).digest('hex'),amount:refundMoneyText(units),estimated_balance_after:after }
    return { ok:true as const,quote }
  } catch { return { ok:false as const,error:'orderCreditUnavailable' } }
}
function receipt(raw:CreditTransaction | null | undefined,id:string,currency:string):StoreCreditReceipt | null {
  if (!raw || raw.__typename!=='StoreCreditAccountCreditTransaction' || !CREDIT_ID.test(raw.id) || !account(raw.account,id,currency) ||
    !money(raw.amount,currency) || (refundMoney(raw.amount.amount) ?? BigInt(0))<=BigInt(0) || !money(raw.balanceAfterTransaction,currency) ||
    typeof raw.createdAt!=='string' || !Number.isFinite(Date.parse(raw.createdAt)) || raw.expiresAt!==null && (typeof raw.expiresAt!=='string' || !Number.isFinite(Date.parse(raw.expiresAt)))) return null
  return { id:raw.id,customer_id:id,account_id:raw.account.id,amount:raw.amount.amount,currency,balance_after:raw.balanceAfterTransaction.amount,current_balance:raw.account.balance.amount,created_at:raw.createdAt,expires_at:raw.expiresAt }
}
async function readReceipt(admin:ShopifyAdmin,id:string,owner:string,currency:string) {
  if (!CREDIT_ID.test(id)) return null
  const { node }=await client(admin).graphql<{ node?:CreditTransaction | null }>(`query ObservedCredit($id:ID!){node(id:$id){${CREDIT}}}`,{ id })
  return node?.id===id ? receipt(node,owner,currency) : null
}
/** A balance or a similar amount never establishes that a lost response belongs to this operation. */
export async function inspectStoreCredit(admin:ShopifyAdmin,source:StoreCreditSource,transactionId?:string):Promise<ObservedStoreCredit | null> {
  const current=await readAccount(admin,source)
  if (!current) return null
  if (transactionId) {
    const observed=await readReceipt(admin,transactionId,current.state.customer_id,current.state.currency)
    if (!observed || current.state.account_id!==observed.account_id) return null
    return { ...current.state,receipt:observed,recent_credits:[],more_credits:false }
  }
  if (!current.state.account_id) return { ...current.state,receipt:null,recent_credits:[],more_credits:false }
  const { storeCreditAccount:history }=await client(admin).graphql<{ storeCreditAccount?:Account & { transactions:{ pageInfo:{ hasNextPage:boolean }; nodes:CreditTransaction[] } } | null }>(
    `query RecentCredit($id:ID!){storeCreditAccount(id:$id){${ACCOUNT} transactions(first:20,reverse:true,query:"type:credit"){pageInfo{hasNextPage} nodes{${CREDIT}}}}}`,{ id:current.state.account_id })
  if (!history || history.id!==current.state.account_id || !account(history,current.state.customer_id,current.state.currency) || !Array.isArray(history.transactions?.nodes) ||
    history.transactions.nodes.length>20 || typeof history.transactions.pageInfo?.hasNextPage!=='boolean') return null
  const recent:StoreCreditReceipt[]=[]
  for (const raw of history.transactions.nodes) {
    const item=receipt(raw,current.state.customer_id,current.state.currency)
    if (!item || item.account_id!==history.id) return null
    recent.push(item)
  }
  return { ...current.state,balance:history.balance.amount,receipt:null,recent_credits:recent,more_credits:history.transactions.pageInfo.hasNextPage }
}
export async function issueReviewedStoreCredit(admin:ShopifyAdmin,source:StoreCreditSource,amount:number,quote:StoreCreditQuote) {
  const current=await prepareStoreCredit(admin,source,amount)
  if (!current.ok || current.quote.fingerprint!==quote.fingerprint || current.quote.amount!==quote.amount) return { ok:false as const,error:current.ok ? 'orderChanged' : current.error }
  let transactionId:string | undefined,attempted=false
  try {
    attempted=true
    const data=await client(admin).graphql<{ storeCreditAccountCredit?:{ storeCreditAccountTransaction?:{ id:string } | null; userErrors:{ message:string }[] } }>(
      'mutation IssueReviewedCredit($id:ID!,$input:StoreCreditAccountCreditInput!){storeCreditAccountCredit(id:$id,creditInput:$input){storeCreditAccountTransaction{id} userErrors{field message}}}',
      { id:current.quote.account_id ?? current.quote.customer_id,input:{ creditAmount:{ amount:current.quote.amount,currencyCode:current.quote.currency },expiresAt:null } })
    const result=data.storeCreditAccountCredit
    if (result?.userErrors?.length && !result.storeCreditAccountTransaction) return { ok:false as const,error:'orderCreditRejected' }
    transactionId=result?.storeCreditAccountTransaction?.id
    if (!transactionId || result?.userErrors?.length) return { ok:false as const,error:'orderResultUnverified',uncertain:true,transactionId }
    const actual=await readReceipt(admin,transactionId,current.quote.customer_id,current.quote.currency)
    if (!actual || current.quote.account_id && actual.account_id!==current.quote.account_id || refundMoney(actual.amount)!==refundMoney(current.quote.amount) || actual.expires_at!==null) return { ok:false as const,error:'orderResultUnverified',uncertain:true,transactionId }
    return { ok:true as const,receipt:actual }
  } catch { return { ok:false as const,error:attempted ? 'orderResultUnverified' : 'orderCreditUnavailable',...(attempted ? { uncertain:true,transactionId } : {}) } }
}
