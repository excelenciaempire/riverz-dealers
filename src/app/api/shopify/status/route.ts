import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConnectionForUser } from '@/lib/shopify/connection'

/** Current user's Shopify connection state, for the Settings card. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conn = await getConnectionForUser(supabase, user.id)
  const configured = Boolean(process.env.SHOPIFY_API_KEY)
  return NextResponse.json({ configured, connection: conn })
}

/** Disconnect (delete) the user's Shopify connection. */
export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('shopify_connections')
    .delete()
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
