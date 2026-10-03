import { NextResponse } from 'next/server';
import { csrfGuard } from '@/lib/csrf';
import { dealerContext, dealerFailure } from '@/lib/dealers/server';
import {
  assertDealerManager,
  readDealerSettings,
} from '@/lib/dealers/settings-server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { syncDealerInventory } from '@/lib/dealers/inventory-sync';
import { parseDealerFeed } from '@/lib/dealers/feed';
import { DealerError, object } from '@/lib/dealers/validation';
export async function POST(req: Request) {
  const blocked = await csrfGuard(req);
  if (blocked) return blocked;
  try {
    const c = await dealerContext();
    await assertDealerManager(c.db, c.workspaceId, c.userId);
    const b = object(await req.json());
    if (b.action === 'sync')
      return NextResponse.json(
        await syncDealerInventory(supabaseAdmin(), c.workspaceId)
      );
    if (
      !['preview', 'import'].includes(String(b.action)) ||
      typeof b.text !== 'string' ||
      b.text.length > 8 * 1024 * 1024 ||
      !['json', 'csv'].includes(String(b.format))
    )
      throw new DealerError('invalid');
    const format = b.format as 'json' | 'csv';
    if (b.action === 'preview') {
      const { settings } = await readDealerSettings(c.db, c.workspaceId),
        rows = parseDealerFeed(b.text, settings.inventory, format);
      return NextResponse.json({
        units: rows.length,
        unpriced: rows.filter((r) => r.price === null).length,
        sample: rows.slice(0, 5),
      });
    }
    return NextResponse.json(
      await syncDealerInventory(supabaseAdmin(), c.workspaceId, {
        text: b.text,
        format,
      })
    );
  } catch (e) {
    return dealerFailure(e);
  }
}
