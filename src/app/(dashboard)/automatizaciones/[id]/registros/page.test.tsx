import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { translate } from '@/lib/i18n/translate'
const state = vi.hoisted(() => ({ comparison: false, index: 0, locale: 'es' as 'es' | 'en' }))
vi.mock('react', async importOriginal => {
  const real = await importOriginal<typeof import('react')>()
  return {
    ...real,
    use: () => ({ id: 'aut' }),
    useState: (initial: unknown) => {
      const index = state.index++
      if (index === 2) return [{ scope: 'aut:w:', page: { workspace_id: 'w', automation: { id: 'aut', name: 'Reminder' }, next_cursor: 'cursor', logs: [{ id: 'run', status: 'success', contact: { id: 'contact', name: 'Ana' }, steps_executed: [{ step_id: 'step', step_type: 'wait', status: 'success', detail: '2 hours' }], created_at: '2026-10-01T00:00:00Z', trigger_event: 'order_created' }] } }, vi.fn()]
      if (index === 6) return ['run', vi.fn()]
      return [initial, vi.fn()]
    },
  }
})
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/hooks/use-localized-router', () => ({ useLocalizedRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/use-workspace', () => ({ useWorkspace: () => ({ workspace: { id: 'w' }, loading: false }) }))
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(state.locale, key, vars) }))
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return state.comparison } }))
vi.mock('@/components/automations/run-journey', () => ({ RunJourney: () => <div>Existing journey</div> }))
import Page from './page'
beforeEach(() => { state.index = 0; state.comparison = false; state.locale = 'es' })
describe('history additions stay reserved for comparison', () => {
  it.each(['es', 'en'] as const)('keeps current rows and journey without new controls in %s', locale => {
    state.locale = locale
    const html = renderToStaticMarkup(<Page params={Promise.resolve({ id: 'aut' })} />)
    expect(html).toContain('Ana'); expect(html).toContain('Existing journey')
    expect(html).not.toContain('type="date"'); expect(html).not.toContain('<select')
    expect(html).not.toContain(locale === 'es' ? 'Cargar anteriores' : 'Load older runs')
  })
  it.each(['es', 'en'] as const)('shows translated filters and continuation only in comparison mode (%s)', locale => {
    state.comparison = true; state.locale = locale
    const html = renderToStaticMarkup(<Page params={Promise.resolve({ id: 'aut' })} />)
    expect(html).toContain('<select'); expect(html).toContain('type="date"')
    expect(html).toContain(locale === 'es' ? 'Cargar anteriores' : 'Load older runs')
    expect(html).toContain(locale === 'es' ? 'Ver registros de este contacto' : 'View this contact’s runs')
    expect(html).toContain('Existing journey')
  })
})
