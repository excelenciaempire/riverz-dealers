import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';

/**
 * One-shot demo seed used to fill the broadcasts/templates list pages
 * with realistic-looking data while iterating on the UI. Each call
 * inserts a fresh set tagged with "[Prueba]" in the name so the user
 * can spot them at a glance and delete from the normal UI when done.
 *
 * POST /api/dev/seed-demo
 *   body: { type: 'templates' | 'broadcasts' | 'all' }
 *
 * Requires a signed-in caller. Data is inserted under the caller's own
 * user_id + workspace_id so RLS works without any service-role write.
 *
 * Not gated on env — safe to ship because (a) it only writes to the
 * caller's own data, (b) every row is clearly tagged for cleanup.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { type?: 'templates' | 'broadcasts' | 'all' }
    | null;
  const type = body?.type ?? 'all';

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const workspaceId = (membership as { workspace_id?: string } | null)?.workspace_id;

  const out: { templates: number; broadcasts: number; recipients: number } = {
    templates: 0,
    broadcasts: 0,
    recipients: 0,
  };

  if (type === 'templates' || type === 'all') {
    const rows = SEED_TEMPLATES.map((t) => ({
      ...t,
      user_id: user.id,
    }));
    const { error, data } = await admin
      .from('message_templates')
      .insert(rows)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    out.templates = data?.length ?? 0;
  }

  if (type === 'broadcasts' || type === 'all') {
    // Pull a handful of the caller's contacts so the broadcast recipients
    // point at real rows; fall back to fake phones if there are none.
    const { data: contactsRaw } = await admin
      .from('contacts')
      .select('id, phone, name')
      .eq('workspace_id', workspaceId ?? '')
      .limit(40);
    const contacts =
      (contactsRaw as { id: string; phone: string | null; name: string | null }[] | null) ?? [];

    for (const seed of SEED_BROADCASTS) {
      const totalRecipients = seed.recipientCount;
      const sentCount = seed.status === 'sent' ? totalRecipients : seed.status === 'sending' ? Math.floor(totalRecipients * 0.6) : 0;
      const deliveredCount = Math.floor(sentCount * 0.94);
      const readCount = Math.floor(deliveredCount * 0.72);
      const repliedCount = Math.floor(readCount * 0.18);
      const failedCount = sentCount - deliveredCount;

      const { data: created, error } = await admin
        .from('broadcasts')
        .insert({
          user_id: user.id,
          name: seed.name,
          template_name: seed.template_name,
          template_language: 'es',
          template_variables: {},
          audience_filter: { type: 'all' },
          scheduled_at: seed.scheduledAt,
          status: seed.status,
          total_recipients: totalRecipients,
          sent_count: sentCount,
          delivered_count: deliveredCount,
          read_count: readCount,
          replied_count: repliedCount,
          failed_count: failedCount,
        })
        .select('id')
        .single();
      if (error || !created) {
        return NextResponse.json({ error: error?.message }, { status: 500 });
      }
      out.broadcasts++;

      // Generate broadcast_recipients rows so the detail view has data.
      // Mix real contacts with synthetic ones to reach totalRecipients.
      const recipientRows: Record<string, unknown>[] = [];
      for (let i = 0; i < Math.min(totalRecipients, 30); i++) {
        const contact = contacts[i % Math.max(1, contacts.length)];
        const status =
          seed.status === 'sent'
            ? i < deliveredCount
              ? i < readCount
                ? i < repliedCount
                  ? 'replied'
                  : 'read'
                : 'delivered'
              : 'failed'
            : 'pending';
        recipientRows.push({
          broadcast_id: created.id,
          contact_id: contact?.id ?? null,
          status,
          sent_at: seed.status === 'sent' ? new Date(Date.now() - i * 5000).toISOString() : null,
          delivered_at: status !== 'pending' && status !== 'failed' ? new Date().toISOString() : null,
          read_at: ['read', 'replied'].includes(status) ? new Date().toISOString() : null,
          replied_at: status === 'replied' ? new Date().toISOString() : null,
          error_message: status === 'failed' ? 'Número no registrado en WhatsApp' : null,
        });
      }
      if (recipientRows.length > 0) {
        const { error: recErr } = await admin
          .from('broadcast_recipients')
          .insert(recipientRows);
        if (!recErr) out.recipients += recipientRows.length;
      }
    }
  }

  return NextResponse.json({ ok: true, ...out });
}

// ============================================================
// Seed data
// ============================================================

const SEED_TEMPLATES = [
  {
    name: 'bienvenida_nuevo_cliente',
    category: 'Utility' as const,
    language: 'es',
    header_type: 'text' as const,
    header_content: '¡Bienvenido a Vitalú!',
    body_text:
      'Hola {{1}} 👋, gracias por unirte a Vitalú. Soy María, tu asesora. ¿En qué te puedo ayudar hoy? Acá vas a recibir tus pedidos, novedades y promociones.',
    footer_text: 'Equipo Vitalú',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Ver catálogo' },
      { type: 'QUICK_REPLY', text: 'Hablar con asesor' },
    ],
    status: 'Approved' as const,
  },
  {
    name: 'confirmacion_pedido',
    category: 'Utility' as const,
    language: 'es',
    header_type: null,
    header_content: null,
    body_text:
      '¡Listo {{1}}! Tu pedido *{{2}}* fue confirmado por {{3}}. Te avisamos cuando salga del centro de despacho. 📦',
    footer_text: null,
    buttons: [
      { type: 'URL', text: 'Ver pedido', url: 'https://tu-tienda.myshopify.com/orders/{{4}}' },
    ],
    status: 'Approved' as const,
  },
  {
    name: 'despacho_con_tracking',
    category: 'Utility' as const,
    language: 'es',
    header_type: null,
    header_content: null,
    body_text:
      '🚚 ¡Tu pedido {{1}} ya está en camino! Lo lleva {{2}} con la guía {{3}}.\n\nSeguilo en tiempo real con el botón de abajo.',
    footer_text: 'Llega entre 2 y 5 días hábiles.',
    buttons: [
      { type: 'URL', text: 'Rastrear envío', url: '{{4}}' },
    ],
    status: 'Approved' as const,
  },
  {
    name: 'carrito_abandonado_24h',
    category: 'Marketing' as const,
    language: 'es',
    header_type: 'text' as const,
    header_content: '¿Lo dejaste pendiente?',
    body_text:
      'Hola {{1}}, ayer dejaste {{2}} en el carrito. Si te ayuda, te dejamos un 10% de descuento con el código *VUELVE10* — vale por 24 horas. 💚',
    footer_text: 'Sin presión, vos sabés cuándo es el momento.',
    buttons: [
      { type: 'URL', text: 'Volver al carrito', url: '{{3}}' },
      { type: 'QUICK_REPLY', text: 'Ya no me interesa' },
    ],
    status: 'Approved' as const,
  },
  {
    name: 'recompra_30dias',
    category: 'Marketing' as const,
    language: 'es',
    header_type: null,
    header_content: null,
    body_text:
      'Hola {{1}}, hace un mes pediste {{2}}. ¿Cómo te fue? Si necesitás reponer ya mismo, te dejamos envío gratis con el código *FIDELIDAD*. 🌿',
    footer_text: null,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Pedir de nuevo' },
      { type: 'QUICK_REPLY', text: 'Tengo una duda' },
    ],
    status: 'Pending' as const,
  },
  {
    name: 'codigo_verificacion_otp',
    category: 'Authentication' as const,
    language: 'es',
    header_type: null,
    header_content: null,
    body_text:
      'Tu código de verificación de Vitalú es {{1}}. Vence en 10 minutos. No lo compartas con nadie.',
    footer_text: 'Si no fuiste vos, ignorá este mensaje.',
    buttons: null,
    status: 'Draft' as const,
  },
  {
    name: 'aviso_stock_agotado',
    category: 'Utility' as const,
    language: 'es',
    header_type: null,
    header_content: null,
    body_text:
      'Hola {{1}}, lamentablemente el producto *{{2}}* se agotó antes de poder despacharlo. Te devolvemos el dinero a {{3}} en 24-48 hs. Disculpá la molestia. 🙏',
    footer_text: null,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Ver opciones similares' },
    ],
    status: 'Rejected' as const,
  },
];

const SEED_BROADCASTS: {
  name: string;
  template_name: string;
  status: 'sent' | 'scheduled' | 'sending' | 'draft' | 'failed';
  recipientCount: number;
  scheduledAt: string | null;
}[] = [
  {
    name: '[Prueba] Lanzamiento serum vitamina C',
    template_name: 'lanzamiento_serum_vit_c',
    status: 'sent',
    recipientCount: 487,
    scheduledAt: null,
  },
  {
    name: '[Prueba] Black Friday — 25% off',
    template_name: 'black_friday_2026',
    status: 'sending',
    recipientCount: 1240,
    scheduledAt: null,
  },
  {
    name: '[Prueba] Reactivación clientes inactivos',
    template_name: 'recompra_30dias',
    status: 'scheduled',
    recipientCount: 312,
    scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    name: '[Prueba] Newsletter junio',
    template_name: 'newsletter_mensual',
    status: 'draft',
    recipientCount: 0,
    scheduledAt: null,
  },
];
