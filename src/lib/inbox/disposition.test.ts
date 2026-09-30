import { describe,expect,it } from 'vitest'
import { dispositionInput } from './disposition'
import { actionableUnreadCount } from './actionable-unread'
import { conversationMatchesView,savedViewConfig } from './saved-views'
import type { Conversation } from '@/types'
const id='11111111-1111-4111-8111-111111111111'
describe('case disposition contract and filters',() => {
  it('rejects tenant overrides, unsafe versions and unknown actions',() => {
    const input={ id,action:'unread',expected_version:0 }
    expect(dispositionInput(input)).toEqual(input)
    for (const bad of [{ ...input,workspace_id:id },{ ...input,expected_version:-1 },{ ...input,expected_version:1.5 },{ ...input,expected_version:1e20 },{ ...input,action:'block' },{ ...input,id:'invalid' }]) expect(dispositionInput(bad)).toBeNull()
  })
  it('keeps a deliberate unread mark after a team response, excluding spam notifications',() => {
    expect(actionableUnreadCount({ unread_count:0,last_sender_type:'agent',manual_unread:true })).toBe(1)
    expect(actionableUnreadCount({ unread_count:2,last_sender_type:'bot',manual_unread:true,is_spam:true })).toBe(0)
  })
  it('finds spam even while snoozed and keeps ordinary views clean',() => {
    const c={ channel:'whatsapp',is_spam:true,snoozed_until:'2100-01-01',status:'open' } as Conversation
    expect(savedViewConfig({ status:'spam' })).toEqual({ status:'spam' })
    expect(conversationMatchesView(c,{ status:'spam' },id)).toBe(true)
    expect(conversationMatchesView(c,{ status:'snoozed' },id)).toBe(false)
    expect(conversationMatchesView(c,{},id)).toBe(false)
    expect(conversationMatchesView({ ...c,is_spam:false },{ status:'spam' },id)).toBe(false)
    expect(conversationMatchesView({ ...c,is_spam:false,snoozed_until:null,manual_unread:true,unread_count:0,last_sender_type:'bot' },{ status:'unread' },id)).toBe(true)
  })
})
