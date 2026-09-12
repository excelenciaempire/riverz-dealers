"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
import { useWorkspace } from "@/hooks/use-workspace";
import { canonicalizePath } from "@/lib/i18n/routes";
import { sectionRedirect } from "@/lib/admin/feature-flags";
import { useFeatureFlags } from "@/hooks/use-feature-flags";

/**
 * RBAC navigation guard. A restricted member who lands on (or is linked to) a
 * section they weren't granted gets redirected to one they can open. The
 * sidebar already hides those items; this covers direct URLs / stale links.
 * Not a data boundary — Supabase RLS scopes all workspace data to membership.
 */
export function SectionGuard() {
  const pathname = usePathname();
  const router = useLocalizedRouter();
  const { membership, loading } = useWorkspace();
  const { flags, isPlatformAdmin } = useFeatureFlags();

  useEffect(() => {
    const path = canonicalizePath(pathname ?? "/");
    if (loading || !membership) return;
    const allowed =
      membership.role === "admin" ? null : (membership.allowed_sections ?? null);
    const dest = sectionRedirect(path, allowed, flags, isPlatformAdmin);
    if (dest) router.replace(dest);
  }, [pathname, membership, loading, router, flags, isPlatformAdmin]);

  return null;
}
