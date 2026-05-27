"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Radio,
  Zap,
  Workflow,
  Settings,
  LogOut,
  User,
  X,
  PanelLeftClose,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { href: "/inbox", label: "Bandeja", icon: MessageSquare },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/broadcasts", label: "Difusión", icon: Radio },
  { href: "/automations", label: "Automatizaciones", icon: Zap },
  { href: "/flows", label: "Flujos", icon: Workflow },
];

const bottomNavItems = [
  { href: "/settings", label: "Ajustes", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
  /** Desktop-only — when true, sidebar shrinks to an icon-only rail. */
  collapsed?: boolean;
  /** Fired when the user clicks the collapse/expand toggle inside the
   *  sidebar. Mirrors the same toggle in the header so users have a
   *  control wherever they happen to be looking. */
  onToggleCollapsed?: () => void;
}

export function Sidebar({
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const totalUnread = useTotalUnread();

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Cerrar menú"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left, always full width.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible. Width swaps with `collapsed`.
          // Keep transition on so the swap animates.
          "lg:static lg:z-0 lg:translate-x-0 lg:transition-[width] lg:duration-200",
          collapsed ? "lg:w-14" : "lg:w-60",
        )}
        aria-label="Principal"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-slate-800",
            collapsed ? "lg:justify-center lg:px-2" : "px-4",
            "justify-between gap-2",
          )}
        >
          <Link
            href="/dashboard"
            className={cn(
              "flex items-center gap-2",
              collapsed && "lg:justify-center",
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "text-sm font-semibold text-white",
                collapsed && "lg:hidden",
              )}
            >
              Bandeja Unificada
            </span>
          </Link>
          {/* Mobile close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
          {/* Desktop collapse button — hidden in collapsed mode so the
              row stays clean; the header has the matching expand toggle. */}
          {onToggleCollapsed && !collapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Contraer menú"
              title="Contraer menú"
              className="hidden h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white lg:flex"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Main navigation */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto py-4",
            collapsed ? "lg:px-2" : "px-3",
          )}
        >
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                totalUnread={totalUnread}
              />
            ))}
          </ul>

          <div className="my-4 border-t border-slate-800" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                totalUnread={0}
              />
            ))}
          </ul>
        </nav>

        {/* User section */}
        <div
          className={cn(
            "shrink-0 border-t border-slate-800",
            collapsed ? "lg:p-2" : "p-3",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex w-full items-center rounded-lg text-left transition-colors hover:bg-slate-800/60 focus:bg-slate-800/60 focus:outline-none data-popup-open:bg-slate-800/60",
                collapsed ? "lg:justify-center lg:p-2" : "gap-3 px-3 py-2",
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  "min-w-0 flex-1",
                  collapsed && "lg:hidden",
                )}
              >
                <p className="truncate text-sm font-medium text-white">
                  {profile?.full_name ?? "Usuario"}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-slate-900 text-slate-100 ring-slate-700"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-slate-200 focus:bg-slate-800 focus:text-white"
                  />
                }
              >
                <User className="size-4" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=channels"
                    onClick={onClose}
                    className="text-slate-200 focus:bg-slate-800 focus:text-white"
                  />
                }
              >
                <Settings className="size-4" />
                Ajustes
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-slate-200 focus:bg-slate-800 focus:text-white"
              >
                <LogOut className="size-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
  totalUnread,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  totalUnread: number;
}) {
  const isActive =
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));

  const showUnreadDot =
    item.href === "/inbox" && totalUnread > 0 && !isActive;

  const link = (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
        collapsed ? "lg:justify-center lg:px-0 lg:py-2.5" : "px-3 py-2.5 lg:py-2",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-slate-400 hover:bg-slate-800 hover:text-white",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className={cn("flex-1", collapsed && "lg:hidden")}>
        {item.label}
      </span>
      {item.beta && !collapsed && (
        <span
          aria-label="Función Beta"
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
        >
          Beta
        </span>
      )}
      {showUnreadDot && (
        <span
          aria-label={`${totalUnread} conversación${totalUnread === 1 ? "" : "es"} sin leer`}
          className={cn(
            "relative flex h-2 w-2",
            collapsed && "lg:absolute lg:right-1 lg:top-1",
          )}
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      )}
    </Link>
  );

  // In collapsed mode, hover-tooltips replace the label so the user can
  // still identify each icon. Tooltips only render on desktop where the
  // collapsed state actually applies.
  return (
    <li>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger render={link} />
          <TooltipContent side="right" sideOffset={8}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}
