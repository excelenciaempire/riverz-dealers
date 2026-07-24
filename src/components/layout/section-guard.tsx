"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
import { useWorkspace } from "@/hooks/use-workspace";
import { canonicalizePath } from "@/lib/i18n/routes";
import { canAccessSection, GATEABLE_KEYS } from "@/lib/rbac/sections";

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

  useEffect(() => {
    if (loading || !membership) return;
    const allowed =
      membership.role === "admin" ? null : (membership.allowed_sections ?? null);
    if (allowed == null) return; // full access
    const path = canonicalizePath(pathname ?? "/");
    if (canAccessSection(allowed, path)) return;
    // Send them somewhere they CAN go: first granted section, else settings.
    const dest = allowed.find((s) => GATEABLE_KEYS.includes(s)) ?? "/ajustes";
    router.replace(dest);
  }, [pathname, membership, loading, router]);

  return null;
}
