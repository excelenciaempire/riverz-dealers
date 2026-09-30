import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { ensureWorkspace } from "@/lib/workspaces/ensure";
import { needsReconsent } from "@/lib/legal/version";
import { ReconsentGate } from "@/components/legal/reconsent-gate";
import { getFeatureFlags, type FeatureFlags } from "@/lib/admin/feature-flags";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { isWorkspaceSuspended } from "@/lib/workspaces/suspension";
import { SuspendedGate } from "@/components/layout/suspended-gate";
import { ImpagoGate } from "@/components/billing/impago-gate";
import { AvisoDeCobro } from "@/components/billing/aviso-cobro";
import { estadoDeCobro, type Aviso, type Vistazo } from "@/lib/wallet/puerta";

// Force dynamic rendering per-request so the CSP nonce minted by the
// proxy (forwarded via the x-nonce header) is available to inject into
// streaming inline scripts. Static prerender would strip the nonce and
// any boot script would be blocked by CSP.
export const dynamic = "force-dynamic";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Self-heal: if the signup trigger (handle_new_workspace_for_user,
  // migration 013) failed silently, this user has no workspace and the
  // dashboard would break with no recovery. Resolve the user and ensure a
  // workspace exists before rendering. ensureWorkspace is idempotent and
  // only writes when a membership is missing (one cheap membership query
  // in the common case). A failure here must NOT block the dashboard from
  // rendering — the bootstrap route remains as a manual retry path.
  let mustReconsent = false;
  let flags: FeatureFlags = {};
  let platformAdmin = false;
  let suspended = false;
  let impago = false;
  let aviso: Aviso = null;
  let horasDeGracia: number | null = null;
  let saldo: Vistazo | null = null;
  let invoiceUrl: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    platformAdmin = isPlatformAdmin(user?.email);
    if (user) {
      // El workspace primero: los flags ahora admiten una excepción por
      // comercio, así que hay que saber de qué comercio se trata antes de
      // resolverlos. `ensureWorkspace` ya lo resuelve internamente, así que
      // capturar su retorno no cuesta ninguna consulta extra.
      const workspaceId = await ensureWorkspace(
        supabaseAdmin(),
        user.id,
        user.email,
        user.user_metadata,
      );
      // Feature flags para esconder funcionalidades del menú y bloquear su URL:
      // el valor global, con la excepción del comercio pisándolo. Fail-soft:
      // ante error, todo habilitado. Solo para sesiones reales — un visitante
      // anónimo no llega a ver el menú, así que consultarlo fuera del `if` era
      // una query de más en cada render.
      flags = await getFeatureFlags(supabaseAdmin(), workspaceId);
      // Cuenta suspendida por el equipo (cobro manual). El panel del equipo
      // no ve esta pantalla: si un admin de plataforma entra a una cuenta
      // suspendida para revisarla, cortarle el acceso sería justo al revés
      // de lo que necesita.
      suspended =
        !platformAdmin &&
        (await isWorkspaceSuspended(supabaseAdmin(), workspaceId));
      // Cobro: la mensualidad tiene 24 horas de gracia y luego pausa la IA.
      // La bandeja manual sigue abierta. Un admin de
      // plataforma que entra a mirar una cuenta impaga no ve la pared: la
      // necesita abierta justamente para ayudar a destrabarla.
      //
      // El saldo del menú, en cambio, SÍ lo ve: es el mismo número que ve el
      // comercio y sin él la pieza no se puede probar con la cuenta del
      // dueño, que es admin de plataforma. Sale de esta misma lectura, así
      // que mostrarlo no cuesta una consulta más.
      if (workspaceId) {
        const cobro = await estadoDeCobro(supabaseAdmin(), workspaceId);
        saldo = cobro.vistazo;
        invoiceUrl = cobro.vistazo.mensualidad?.invoiceUrl ?? null;
        if (cobro.vistazo.mensualidad) {
          aviso = cobro.aviso;
          horasDeGracia = cobro.horas;
        }
        if (!platformAdmin) {
          impago = cobro.bloqueado;
          aviso = cobro.aviso;
          horasDeGracia = cobro.horas;
        }
      }
      // Re-consent gate: if the Terms/Privacy changed since this user last
      // accepted (LEGAL_VERSION bumped), block the app until they accept the
      // new version. Fail-soft — any read error defaults to NOT gating so a
      // hiccup can never lock a user out of their inbox.
      const { data: profile } = await supabaseAdmin()
        .from("profiles")
        .select("terms_version")
        .eq("user_id", user.id)
        .maybeSingle();
      mustReconsent = needsReconsent(
        (profile as { terms_version?: string | null } | null)?.terms_version ?? null,
      );
    }
  } catch (err) {
    console.error("[dashboard/layout] bootstrap failed:", err);
  }

  if (suspended) return <SuspendedGate />;
  if (impago) return <ImpagoGate />;

  return (
    <>
      {mustReconsent && <ReconsentGate />}
      <DashboardShell
        flags={flags}
        isPlatformAdmin={platformAdmin}
        aviso={<AvisoDeCobro aviso={aviso} horas={horasDeGracia} invoiceUrl={invoiceUrl} />}
        saldo={saldo}
      >
        {children}
      </DashboardShell>
    </>
  );
}
