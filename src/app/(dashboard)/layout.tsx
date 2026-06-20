import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { ensureWorkspace } from "@/lib/workspaces/ensure";

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
    }
  } catch (err) {
    console.error("[dashboard/layout] ensureWorkspace failed:", err);
  }

  return <DashboardShell>{children}</DashboardShell>;
}
