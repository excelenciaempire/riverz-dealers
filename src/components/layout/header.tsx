"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { useT } from "@/hooks/use-locale";

interface HeaderProps {
  /** Opens the slide-in drawer on mobile. */
  onOpenSidebar?: () => void;
}

/**
 * Mobile-only top bar. On desktop the sidebar owns all chrome (brand,
 * nav, account, theme toggle) — matching Riverz, which has no top bar —
 * so this is hidden at lg+. On mobile it provides the hamburger to open
 * the drawer plus the brand wordmark.
 */
export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useT();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 lg:hidden">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label={t("layout.openMenu")}
        className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Link
        href="/panel"
        aria-label="riverz"
        className="text-[19px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink"
      >
        riverz
      </Link>
    </header>
  );
}
