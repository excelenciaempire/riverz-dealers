import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { adminGet, intParam } from '@/lib/admin/route';
import { recordAdminAction } from '@/lib/admin/audit';
import {
  generateSignupCode,
  normalizeSignupCode,
  type SignupCodeRow,
} from '@/lib/auth/signup-codes';

/**
 * Códigos de invitación (solo equipo Riverz).
 *
 *   GET                                        → { rows, total }
 *   POST { quantity, note, maxUses, expiresInDays } → emite códigos
 *   PATCH { id, revoked }                      → revoca o reactiva uno
 *
 * Es la puerta del alta: sin un código acá, nadie crea cuenta desde
 * `/registro` (ver `lib/auth/signup-codes.ts`).
 */

const MAX_QUANTITY = 50;

export async function GET(request: Request) {
  return adminGet(request, { action: 'view.signup_codes' }, async () => {
    const url = new URL(request.url);
    const limit = intParam(url, 'limit', 200, 500);
    const db = supabaseAdmin();

    const { data, error, count } = await db
      .from('signup_codes')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as SignupCodeRow[];

    // Quién usó cada código, en una sola consulta. Sin esto la tabla diría
    // "2 de 5" sin poder responder la única pregunta que sigue: quiénes.
    const { data: redenciones } = await db
      .from('signup_code_redemptions')
      .select('code_id, email, redeemed_at')
      .in('code_id', rows.length ? rows.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000'])
      .order('redeemed_at', { ascending: false });

    const porCodigo: Record<string, { email: string; redeemed_at: string }[]> = {};
    for (const r of redenciones ?? []) {
      (porCodigo[r.code_id as string] ??= []).push({
        email: r.email as string,
        redeemed_at: r.redeemed_at as string,
      });
    }

    return {
      rows: rows.map((r) => ({ ...r, redemptions: porCodigo[r.id] ?? [] })),
      total: count ?? rows.length,
    };
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    quantity?: number;
    note?: string;
    maxUses?: number;
    expiresInDays?: number;
    /** Código a dedo, para uno memorable. Si no viene, se genera. */
    code?: string;
  } | null;

  const quantity = Math.min(Math.max(Math.floor(body?.quantity ?? 1), 1), MAX_QUANTITY);
  const maxUses = Math.min(Math.max(Math.floor(body?.maxUses ?? 1), 1), 10_000);
  const note = body?.note?.trim() || null;
  const dias = Number(body?.expiresInDays);
  const expiresAt =
    Number.isFinite(dias) && dias > 0
      ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString()
      : null;

  // Un código a mano vale para uno solo: pedir diez con el mismo texto es
  // pedir nueve choques contra el índice único.
  const manual = body?.code ? normalizeSignupCode(body.code) : '';
  if (manual && (manual.length < 4 || quantity > 1)) {
    return NextResponse.json({ error: 'invalid manual code' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const creados: string[] = [];

  for (let i = 0; i < quantity; i++) {
    // El código se sortea; si ya existía, se vuelve a sortear. Con 31^8
    // combinaciones el segundo intento prácticamente nunca ocurre, pero el
    // índice único es quien decide, no la probabilidad.
    let ultimoError = 'insert failed';
    for (let intento = 0; intento < 5; intento++) {
      const code = manual || generateSignupCode();
      const { error } = await db.from('signup_codes').insert({
        code,
        note,
        max_uses: maxUses,
        expires_at: expiresAt,
        created_by: gate.actor.userId,
        created_by_email: gate.actor.email,
      });
      if (!error) {
        creados.push(code);
        break;
      }
      ultimoError = error.message;
      // Un código escrito a mano que ya existe no se reintenta: sortear otro
      // no es lo que pidió quien lo escribió.
      if (manual) break;
    }
    if (creados.length !== i + 1) {
      return NextResponse.json({ error: ultimoError, created: creados }, { status: 500 });
    }
  }

  await recordAdminAction(gate.actor, request, {
    action: 'create.signup_code',
    targetType: 'signup_code',
    meta: { quantity: creados.length, maxUses, note, expiresAt },
  });

  return NextResponse.json({ ok: true, codes: creados });
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    revoked?: boolean;
  } | null;
  if (!body?.id || typeof body.revoked !== 'boolean') {
    return NextResponse.json({ error: 'id and revoked required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from('signup_codes')
    .update({ revoked_at: body.revoked ? new Date().toISOString() : null })
    .eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAdminAction(gate.actor, request, {
    action: 'revoke.signup_code',
    targetType: 'signup_code',
    targetId: body.id,
    meta: { revoked: body.revoked },
  });

  return NextResponse.json({ ok: true });
}
