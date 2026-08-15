import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { buscarCliente, scopeInterno } from '@/lib/mcp/oauth';
import { getT } from '@/lib/i18n/server';
import { ConsentForm } from './consent-form';

export const dynamic = 'force-dynamic';

/**
 * "¿Le doy acceso a mi cuenta a este programa?"
 *
 * Es la única pantalla de todo el flujo de OAuth que ve una persona, así que
 * tiene que decir tres cosas sin que haya que buscarlas: quién pide, a qué
 * cuenta, y qué va a poder hacer. Un consentimiento que no dice qué se está
 * consintiendo no es consentimiento.
 *
 * Se resuelve en el servidor: si no hay sesión, primero a entrar — con la vuelta
 * a esta misma URL, para no perder el pedido del cliente por el camino.
 */
export default async function AutorizarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? '';

  const clientId = one('client_id');
  const redirectUri = one('redirect_uri');
  const scope = one('scope');
  const state = one('state');
  const codeChallenge = one('code_challenge');
  const method = one('code_challenge_method') || 'S256';

  const t = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Volver acá después de entrar: sin esto, la persona entra y aterriza en el
    // panel, y el conector se queda esperando para siempre.
    const volver = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === 'string' ? [[k, v] as [string, string]] : [],
      ),
    );
    redirect(`/ingresar?next=${encodeURIComponent(`/oauth/autorizar?${volver}`)}`);
  }

  if (!clientId || !redirectUri || !codeChallenge || method !== 'S256') {
    return <Aviso texto={t('oauth.badRequest')} />;
  }

  const db = supabaseAdmin();
  const cliente = await buscarCliente(db, clientId);
  if (!cliente || !cliente.redirect_uris.includes(redirectUri)) {
    return <Aviso texto={t('oauth.unknownClient')} />;
  }

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) return <Aviso texto={t('oauth.noWorkspace')} />;

  const { data: ws } = await db
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle();

  return (
    <ConsentForm
      clientName={cliente.name}
      workspaceName={(ws as { name?: string } | null)?.name ?? '—'}
      escribe={scopeInterno(scope) === 'total'}
      params={{
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: method,
      }}
    />
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}
