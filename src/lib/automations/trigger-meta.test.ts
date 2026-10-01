import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelative } from './trigger-meta'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
describe('automation run dates follow the current language',()=>{
 it('retains the existing Spanish default for callers without a locale',()=>{
  expect(formatRelative('2026-10-01T11:30:00Z')).toBe('hace 30 min')
 })
 it.each([
  ['2026-10-01T11:59:55Z','hace un momento','just now'],
  ['2026-10-01T11:30:00Z','hace 30 min','30 min ago'],
  ['2026-10-01T09:00:00Z','hace 3 h','3 h ago'],
  ['2026-09-29T12:00:00Z','hace 2 d','2 d ago'],
 ])('formats %s in either supported language', (timestamp,es,en)=>{
  expect(formatRelative(timestamp,'es')).toBe(es);expect(formatRelative(timestamp,'en')).toBe(en)
 })
 it.each([null,undefined,'not-a-date'])('handles unavailable dates consistently: %s',value=>{
  expect(formatRelative(value,'es')).toBe('nunca');expect(formatRelative(value,'en')).toBe('never')
 })
 it('formats older dates with the selected locale',()=>{
  const value='2026-01-20T12:00:00Z',date=new Date(value)
  expect(formatRelative(value,'es')).toBe(new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'numeric',year:'numeric'}).format(date))
  expect(formatRelative(value,'en')).toBe(new Intl.DateTimeFormat('en-US',{day:'numeric',month:'numeric',year:'numeric'}).format(date))
 })
})
