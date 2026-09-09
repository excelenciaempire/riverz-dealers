import { createClient } from '@supabase/supabase-js'
import { cartProductUrl } from '../src/lib/shopify/cart-product-url'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const workspace = 'b814e934-d832-4be9-bad4-79cca51c1e23'
const template = 'rasmiaw_carrito_abandonado_1'

async function main() {
  let updated = 0, unresolved = 0
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('messages').select('id,buttons,conversations!inner(workspace_id)')
      .eq('conversations.workspace_id', workspace).eq('template_name', template)
      .not('buttons', 'is', null).order('id').range(offset, offset + 499)
    if (error) throw error
    for (const message of data ?? []) {
      for (const button of message.buttons ?? []) {
        if (button.type !== 'URL' || !button.url) continue
        const url = new URL(button.url)
        if (!['riverz.co', 'riverzai.com'].includes(url.hostname) || !/^\/r\/[\w-]+$/.test(url.pathname)) continue
        const token = url.pathname.split('/').pop()!
        const { data: link, error: readError } = await db.from('short_links').select('target_url')
          .eq('workspace_id', workspace).eq('token', token).maybeSingle()
        if (readError) throw readError
        if (!link || new URL(link.target_url).pathname.startsWith('/products/')) continue
        const target = await cartProductUrl(db, workspace, link.target_url)
        if (!target) { unresolved++; continue }
        const { error: writeError } = await db.from('short_links').update({ target_url: target })
          .eq('workspace_id', workspace).eq('token', token).eq('target_url', link.target_url)
        if (writeError) throw writeError
        const response = await fetch(button.url, { redirect: 'manual' })
        const actual = new URL(response.headers.get('location') ?? 'https://invalid.test')
        const expected = new URL(target)
        if (actual.origin !== expected.origin || actual.pathname !== expected.pathname
          || actual.searchParams.get('variant') !== expected.searchParams.get('variant')) {
          throw new Error('Public redirect verification failed')
        }
        updated++
      }
    }
    if ((data?.length ?? 0) < 500) break
  }
  console.log(JSON.stringify({ updated, unresolved }))
  // Enable only after the engine commit is live; the default repairs existing links only.
  if (process.argv.includes('--enable')) {
    const { data, error } = await db.from('message_templates').select('id,buttons')
      .eq('workspace_id', workspace).eq('name', template)
    if (error) throw error
    for (const row of data ?? []) {
      const buttons = row.buttons.map((b: Record<string, unknown>) => b.type === 'URL' ? { ...b, url_variable: 'product' } : b)
      const { error: updateError } = await db.from('message_templates').update({ buttons })
        .eq('workspace_id', workspace).eq('id', row.id)
      if (updateError) throw updateError
    }
    console.log('Product destination enabled')
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
