import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMessages, toAnthropic } from './threads'

function database(fail = false) {
  const rows = Array.from({ length: 250 }, (_, i) => ({
    id: String(i).padStart(3, '0'), workspace_id: 'legacy', thread_id: 'thread',
    role: i % 2 ? 'assistant' : 'user', content: { text: `message-${i}` },
    created_at: new Date(i * 1000).toISOString(),
  }))
  rows.push({ ...rows[249], id: 'foreign', workspace_id: 'other', content: { text: 'private' } })
  const db = { from(table: string) {
    let selected = table === 'operator_messages' ? [...rows] : []
    const sorts: Array<{ field: string; ascending: boolean }> = []
    const q = {
      select: () => q,
      eq: (field: string, value: unknown) => {
        selected = selected.filter(row => row[field as keyof typeof row] === value)
        return q
      },
      in: () => q,
      order: (field: string, options: { ascending: boolean }) => { sorts.push({ field, ...options }); return q },
      limit: (n: number) => {
        selected.sort((a, b) => {
          for (const { field, ascending } of sorts) {
            const comparison = String(a[field as keyof typeof a]).localeCompare(String(b[field as keyof typeof b]))
            if (comparison) return ascending ? comparison : -comparison
          }
          return 0
        })
        selected = selected.slice(0, n)
        return q
      },
      then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: selected, error: fail ? { message: 'database unavailable' } : null }).then(resolve),
    }
    return q
  } } as unknown as SupabaseClient
  return db
}

describe('legacy Operator conversation history', () => {
  it('loads the newest 200 messages in chronological order', async () => {
    const messages = await loadMessages(database(), 'thread', 'legacy')
    expect(messages).toHaveLength(200)
    expect(messages[0].text).toBe('message-50')
    expect(messages.at(-1)?.text).toBe('message-249')
    expect(messages.some(m => m.text === 'private')).toBe(false)
    expect(messages.every(m => m.bloques === undefined)).toBe(true)
    const context = toAnthropic(messages)
    expect(context).toHaveLength(20)
    expect(context.at(-1)?.content).toContain('message-249')
  })

  it('does not silently replace unreadable history with an empty conversation', async () => {
    await expect(loadMessages(database(true), 'thread', 'legacy')).rejects.toThrow('operator_history_failed')
  })
})
