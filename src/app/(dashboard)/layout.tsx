import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { ensureWorkspace } from "@/lib/workspaces/ensure";
import { needsReconsent } from "@/lib/legal/version";
import { ReconsentGate } from "@/components/legal/reconsent-gate";

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
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await ensureWorkspace(
        supabaseAdmin(),
        user.id,
        user.email,
        user.user_metadata,
      );
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

  return (
    <>
      {mustReconsent && <ReconsentGate />}
      <DashboardShell>{children}</DashboardShell>
    </>
  );
}
