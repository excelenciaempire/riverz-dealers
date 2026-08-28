import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET/POST /api/ai/instagram-agent/settings
 *
 * The workspace's proactive Instagram controls: `paused` (kill-switch) +
 * `daily_cap` (rolling-24h max) + `auto_reply_comments` + `outreach_enabled`
 * (todos en ig_proactive_settings, migración 093). RLS scopes to members.
 *
 * Ya NO expone `send_mode`: el alcance proactivo es siempre automático y no
 * hay nada que aprobar. La opción se guardaba pero ninguna rama la leía, así
 * que elegir "approval" enviaba igual — una promesa que el producto no
 * cumplía. Se quita en vez de construir una cola de aprobación que nadie pidió.
 */

/** Los cuatro modos de respuesta a un comentario (migración 177). */
const REPLY_MODES = ['dm', 'public_dm', 'public_smart', 'public'];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({
      paused: false,
      daily_cap: 500,
      auto_reply_comments: true,
      outreach_enabled: true,
    });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  const { data } = workspaceId
    ? await supabase
        .from('ig_proactive_settings')
        .select(
          'paused, daily_cap, auto_reply_comments, outreach_enabled, comment_audience, comment_max_thread_replies, comment_public_reply, comment_instagram, comment_facebook, comment_tiktok, comment_reply_mode, marketing_optin_enabled',
        )
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    : { data: null };
  const s = data as {
    paused?: boolean;
    daily_cap?: number;
    auto_reply_comments?: boolean;
    outreach_enabled?: boolean;
    comment_audience?: string;
    comment_max_thread_replies?: number;
    comment_public_reply?: boolean;
    comment_instagram?: boolean;
    comment_facebook?: boolean;
    comment_tiktok?: boolean;
    comment_reply_mode?: string;
    marketing_optin_enabled?: boolean;
  } | null;
  return NextResponse.json({
    paused: s?.paused ?? false,
    daily_cap: s?.daily_cap ?? 500,
    // Sin fila de ajustes, ambas funcionalidades están encendidas (default BD).
    auto_reply_comments: s?.auto_reply_comments !== false,
    outreach_enabled: s?.outreach_enabled !== false,
    // Migración 132 — defaults = la conducta de siempre.
    comment_audience: s?.comment_audience === 'all' ? 'all' : 'intent',
    comment_max_thread_replies:
      typeof s?.comment_max_thread_replies === 'number'
        ? s.comment_max_thread_replies
        : 3,
    comment_public_reply: s?.comment_public_reply === true,
    // En qué redes trabaja (migración 203). Instagram por defecto: es lo que
    // hacía el sistema antes de que la pregunta existiera.
    comment_instagram: s?.comment_instagram !== false,
    comment_facebook: s?.comment_facebook === true,
    // TikTok arranca apagado: superficie nueva y todo lo que sale ahí es
    // público. Se enciende a propósito.
    comment_tiktok: s?.comment_tiktok === true,
    // Qué sale cuando la IA contesta (migración 177). Sin modo guardado se
    // deriva del interruptor viejo, igual que en el motor.
    comment_reply_mode: REPLY_MODES.includes(s?.comment_reply_mode ?? '')
      ? s?.comment_reply_mode
      : s?.comment_public_reply === true
        ? 'public_dm'
        : 'dm',
    // A diferencia del resto, este arranca APAGADO: agrega un mensaje que el
    // cliente ve, así que se enciende a propósito o no se enciende.
    marketing_optin_enabled: s?.marketing_optin_enabled === true,
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
  }
  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.noWorkspace') },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));

  // Workspace-level controls (pause + cap).
  if (
    typeof body.paused === 'boolean' ||
    body.daily_cap != null ||
    typeof body.auto_reply_comments === 'boolean' ||
    typeof body.outreach_enabled === 'boolean' ||
    body.comment_audience != null ||
    body.comment_max_thread_replies != null ||
    typeof body.comment_public_reply === 'boolean' ||
    typeof body.comment_instagram === 'boolean' ||
    typeof body.comment_facebook === 'boolean' ||
    typeof body.comment_tiktok === 'boolean' ||
    typeof body.comment_reply_mode === 'string' ||
    typeof body.marketing_optin_enabled === 'boolean'
  ) {
    const patch: Record<string, unknown> = { workspace_id: workspaceId };
    // A quién contesta la IA en comentarios y cuánto insiste (migración 132).
    // Valor desconocido ⇒ se ignora, no se guarda basura que rompa el CHECK.
    if (body.comment_audience === 'intent' || body.comment_audience === 'all') {
      patch.comment_audience = body.comment_audience;
    }
    if (typeof body.comment_public_reply === 'boolean') {
      patch.comment_public_reply = body.comment_public_reply;
    }
    // Las redes se guardan juntas y nunca todas apagadas: sin ninguna,
    // "Responder con IA" quedaría encendido sin poder contestar en ningún
    // lado. La pantalla lo hace imposible; acá se protege igual.
    if (
      typeof body.comment_instagram === 'boolean' ||
      typeof body.comment_facebook === 'boolean' ||
      typeof body.comment_tiktok === 'boolean'
    ) {
      const fb = body.comment_facebook === true;
      const tt = body.comment_tiktok === true;
      const ig = body.comment_instagram === true;
      patch.comment_instagram = ig || (!fb && !tt);
      patch.comment_facebook = fb;
      patch.comment_tiktok = tt;
    }
    if (REPLY_MODES.includes(body.comment_reply_mode)) {
      patch.comment_reply_mode = body.comment_reply_mode;
      // El interruptor viejo se sigue escribiendo: si algún día se lee esa
      // columna otra vez, dice lo mismo que el modo.
      patch.comment_public_reply = body.comment_reply_mode !== 'dm';
    }
    if (typeof body.marketing_optin_enabled === 'boolean') {
      patch.marketing_optin_enabled = body.marketing_optin_enabled;
    }
    if (body.comment_max_thread_replies != null) {
      patch.comment_max_thread_replies = Math.max(
        0,
        Math.min(10, Math.round(Number(body.comment_max_thread_replies)) || 0),
      );
    }
    if (typeof body.paused === 'boolean') patch.paused = body.paused;
    if (typeof body.auto_reply_comments === 'boolean') {
      patch.auto_reply_comments = body.auto_reply_comments;
    }
    if (typeof body.outreach_enabled === 'boolean') {
      patch.outreach_enabled = body.outreach_enabled;
    }
    if (body.daily_cap != null) {
      patch.daily_cap = Math.max(
        0,
        Math.min(10000, Math.round(Number(body.daily_cap)) || 0),
      );
    }
    const { error } = await supabase
      .from('ig_proactive_settings')
      .upsert(patch, { onConflict: 'workspace_id' });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // `send_mode` ya no existe: el alcance proactivo es siempre automático,
  // no hay nada que aprobar. Lo que decide si se escribe son las puertas
  // reales — spam/intención, el contrato del agente y el límite diario.

  return NextResponse.json({ success: true });
}
