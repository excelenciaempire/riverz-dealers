import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side tag helpers (the `add_tag` automation step only works by
 * tag_id; nothing creates a tag by NAME). Used by the Shopify backfill and
 * the live webhooks to categorize contacts so they're selectable in
 * segments / broadcasts / automations.
 *
 * Tags written here land in the SAME `contact_tags` table the Contactos UI
 * reads, so categories show up there immediately.
 */

/** Stable colors per category family so the Contactos list reads cleanly. */
function colorForCategory(name: string): string {
  if (name.startsWith('oferta:')) return '#6366f1' // indigo
  if (name.startsWith('unidades:')) return '#a855f7' // purple
  if (name === 'carrito-abandonado') return '#f59e0b' // amber
  if (name.startsWith('comprador')) return '#10b981' // emerald
  return '#3b82f6' // default blue
}

/**
 * Find-or-create a tag by (workspace_id, name); returns its id. There is no
 * DB unique on (workspace_id, name), so we SELECT then INSERT. Pass `cache`
 * to dedupe within a batch (backfill) — avoids both repeat lookups and
 * accidentally creating duplicate tags for the same name under concurrency.
 */
export async function ensureTag(
  db: SupabaseClient,
  workspaceId: string,
  name: string,
  opts?: { color?: string; cache?: Map<string, string> },
): Promise<string | null> {
  const key = name.trim()
  if (!key || !workspaceId) return null
  const cacheKey = `${workspaceId}:${key.toLowerCase()}`
  const cached = opts?.cache?.get(cacheKey)
  if (cached) return cached

  const select = async (): Promise<string | null> => {
    const { data } = await db
      .from('tags')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('name', key)
      .limit(1)
    return (data?.[0]?.id as string | undefined) ?? null
  }

  let id = await select()
  if (!id) {
    const { data: created, error } = await db
      .from('tags')
      .insert({
        workspace_id: workspaceId,
        name: key,
        color: opts?.color ?? colorForCategory(key),
      })
      .select('id')
      .single()
    if (error || !created) {
      // Lost a race (or RLS hiccup) — try reading it back once.
      id = await select()
    } else {
      id = created.id as string
    }
  }
  if (id) opts?.cache?.set(cacheKey, id)
  return id
}

/** Attach tag ids to a contact (idempotent; unique on contact_id,tag_id). */
export async function applyTags(
  db: SupabaseClient,
  contactId: string,
  tagIds: (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(tagIds.filter(Boolean) as string[])]
  if (!contactId || ids.length === 0) return
  await db.from('contact_tags').upsert(
    ids.map((tag_id) => ({ contact_id: contactId, tag_id })),
    { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
  )
}

/** Bucket a unit count into a coarse range for segmentation tags. */
export function unitsBucket(units: number): string {
  if (units <= 1) return '1'
  if (units <= 3) return '2-3'
  return '4+'
}

export interface ShopifyCategoryInput {
  /** Completed/paid orders for this customer (0 = never bought). */
  ordersCount: number
  /** True when the contact only has an OPEN abandoned cart (never bought). */
  isAbandoned: boolean
  /** Offer label they chose (from resolveOfferChosen), if any. */
  offerLabel?: string | null
  /** Total units in their order/cart, if known. */
  units?: number | null
}

/**
 * Category tag names for a Shopify contact, per the "Compra + oferta +
 * unidades" scheme: purchase state + chosen offer + unit-count bucket.
 * All lowercase + Spanish, consistent so segments can match them exactly.
 */
export function shopifyCategoryTagNames(input: ShopifyCategoryInput): string[] {
  const tags: string[] = []
  if (input.ordersCount >= 2) tags.push('comprador-recurrente')
  else if (input.ordersCount >= 1) tags.push('comprador')
  if (input.isAbandoned && input.ordersCount === 0) tags.push('carrito-abandonado')

  // Offer OR units — never both. The offer label already encodes the quantity
  // ("2 unidades + 1 gratis"), so a separate "unidades: 2-3" is redundant; we
  // only bucket units when there is NO specific offer. Lowercase the offer so
  // casing variants ("2 Unidades + 1 GRATIS") don't create duplicate tags.
  const offer = (input.offerLabel ?? '').trim().toLowerCase()
  if (offer) {
    tags.push(`oferta: ${offer}`)
  } else {
    const units = Number(input.units) || 0
    if (units > 0) tags.push(`unidades: ${unitsBucket(units)}`)
  }
  return tags
}

/** Ensure + attach the category tags for a Shopify contact in one call. */
export async function applyCategoryTags(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
  input: ShopifyCategoryInput,
  cache?: Map<string, string>,
): Promise<void> {
  const names = shopifyCategoryTagNames(input)
  if (names.length === 0) return
  const ids = await Promise.all(
    names.map((n) => ensureTag(db, workspaceId, n, { cache })),
  )
  await applyTags(db, contactId, ids)
}
