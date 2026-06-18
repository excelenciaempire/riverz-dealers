import type { SupabaseClient } from '@supabase/supabase-js';
import { ShopifyAdminClient } from '@/lib/shopify/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { InstagramPlan } from './types';

/**
 * Per-user Shopify discount codes — Blueberry's "Code: Grace10" mechanic.
 *
 * One price rule backs the whole campaign's percentage offer; each recipient
 * gets a UNIQUE code minted under it. The unique code is both nicer (feels
 * made-for-you) and lets attribution be deterministic: an order that used
 * THIS code converted THIS person, no email/phone guessing.
 *
 * Everything here is best-effort and gated on (a) Shopify connected and (b) a
 * percentage offer. Any failure falls back to the campaign's shared code.
 */

export interface ShopAdmin {
  client: ShopifyAdminClient;
  shopDomain: string;
}

/** Resolve the workspace's active Shopify admin client, or null. */
export async function getShopifyAdmin(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ShopAdmin | null> {
  const { data } = await db
    .from('shopify_connections')
    .select('shop_domain, access_token, status')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const conn = data as { shop_domain: string; access_token: string } | null;
  if (!conn) return null;
  let token: string;
  try {
    token = decrypt(conn.access_token);
  } catch {
    return null;
  }
  return { client: new ShopifyAdminClient(conn.shop_domain, token), shopDomain: conn.shop_domain };
}

/** "10%" / "hasta 10 %" → 10; anything non-percentage → null. */
export function parsePercent(discount: string | null | undefined): number | null {
  if (!discount) return null;
  const m = discount.match(/(\d{1,2})\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 90 ? n : null;
}

/** Uppercase alphanumeric slug from a name, for building a friendly code. */
export function codeSlug(name: string | null | undefined): string {
  const s = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
  return s || 'VIP';
}

/**
 * Ensure the campaign has a Shopify price rule for its percentage offer.
 * Created once, persisted on the campaign. Returns the id, or null when the
 * offer isn't a percentage or Shopify rejects it.
 */
export async function ensureCampaignPriceRule(
  db: SupabaseClient,
  campaign: { id: string; plan: InstagramPlan; shopify_price_rule_id?: number | null },
  client: ShopifyAdminClient,
): Promise<number | null> {
  if (campaign.shopify_price_rule_id) return Number(campaign.shopify_price_rule_id);
  const pct = parsePercent(campaign.plan.offer?.discount);
  if (!pct) return null;
  try {
    const res = await client.rest<{ price_rule?: { id?: number } }>('/price_rules.json', {
      method: 'POST',
      body: {
        price_rule: {
          title: `IG ${campaign.plan.campaign_name} ${pct}%`.slice(0, 60),
          target_type: 'line_item',
          target_selection: 'all',
          allocation_method: 'across',
          value_type: 'percentage',
          value: `-${pct}.0`,
          customer_selection: 'all',
          starts_at: new Date().toISOString(),
        },
      },
    });
    const id = res.price_rule?.id;
    if (!id) return null;
    await db
      .from('instagram_campaigns')
      .update({ shopify_price_rule_id: id })
      .eq('id', campaign.id);
    return Number(id);
  } catch {
    return null;
  }
}

/**
 * Mint a unique discount code under the price rule for one recipient. Tries a
 * clean "<NAME><pct>" first; on a duplicate (422) falls back to suffixed
 * variants derived from the recipient id so it always converges to a unique
 * code. Returns the code or null on hard failure.
 */
export async function mintUniqueCode(
  client: ShopifyAdminClient,
  priceRuleId: number,
  opts: { name: string | null; pct: number; recipientId: string },
): Promise<string | null> {
  const base = codeSlug(opts.name);
  const rid = opts.recipientId.replace(/-/g, '').toUpperCase();
  const candidates = [
    `${base}${opts.pct}`,
    `${base}${opts.pct}${rid.slice(0, 3)}`,
    `${base}${opts.pct}${rid.slice(3, 7)}`,
    `${base}${opts.pct}${rid.slice(7, 12)}`,
  ];
  for (const code of candidates) {
    try {
      await client.rest(`/price_rules/${priceRuleId}/discount_codes.json`, {
        method: 'POST',
        body: { discount_code: { code } },
      });
      return code;
    } catch (e) {
      // 422 = code already taken → try the next candidate; anything else bail.
      if (e instanceof Error && /\b422\b/.test(e.message)) continue;
      return null;
    }
  }
  return null;
}
