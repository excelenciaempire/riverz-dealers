"use client";

import Link from "@/components/i18n/locale-link";
import { usePathname, useSearchParams } from "next/navigation";
import { canonicalizePath } from "@/lib/i18n/routes";
import { useEffect, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useTheme } from "@/hooks/use-theme";
import { useT } from "@/hooks/use-locale";
import { useSetupStatus } from "@/hooks/use-setup-status";
import {
  Home,
  Inbox,
  Users,
  Megaphone,
  LayoutTemplate,
  Zap,
  Sparkles,
  Blocks,
  Settings,
  ShoppingBag,
  Receipt,
  Workflow,
  LogOut,
  User,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  UserRound,
  BarChart3,
  PhoneCall,
  SlidersHorizontal,
} from "lucide-react";
import { isPlatformAdminClient } from "@/lib/auth/platform-admin";
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
import { InstagramIcon } from "@/components/layout/instagram-icon";

interface NavItem {
  href: string;
  /** i18n key (e.g. "nav.inbox") resolved with t() at render time. */
  label: string;
  /** Acepta iconos de lucide y componentes propios (p. ej. el glifo de
   *  Instagram) — todos respetan el contrato `{ className }`. */
  icon: ComponentType<{ className?: string }>;
  beta?: boolean;
  alsoActiveOn?: string[];
}

interface NavGroup {
  /** i18n key for the group title. */
  title: string;
  items: NavItem[];
}

// IA-first sidebar: "Día a día" arriba (operación), "IA y constructor"
// (las dos herramientas que crean experiencias), "Envíos" (los tres
// surfaces de outbound consolidados), "Tienda" (catálogo) y abajo
// configuración. Antes "Atención" mezclaba IA con outbound asíncrono,
// que es lo opuesto. Antes "Menús" no estaba en el rail; ahora es
// "Flujos" y es item raíz.
const navGroups: NavGroup[] = [
  {
    title: "nav.groupDaily",
    items: [
      { href: "/panel", label: "nav.home", icon: Home },
      { href: "/bandeja", label: "nav.inbox", icon: Inbox },
      { href: "/contactos", label: "nav.contacts", icon: Users },
    ],
  },
  {
    title: "nav.groupCustomerService",
    items: [
      { href: "/asistente", label: "nav.assistant", icon: Sparkles },
      { href: "/menus", label: "nav.flows", icon: Workflow },
      { href: "/voz", label: "nav.voice", icon: PhoneCall, beta: true },
    ],
  },
  {
    title: "nav.groupOutbound",
    items: [
      { href: "/campanas", label: "nav.campaigns", icon: Megaphone },
      { href: "/automatizaciones", label: "nav.automations", icon: Zap },
      { href: "/plantillas", label: "nav.templates", icon: LayoutTemplate },
      { href: "/agente-instagram", label: "nav.instagramAgent", icon: InstagramIcon, beta: true },
    ],
  },
  {
    title: "nav.groupStore",
    items: [
      { href: "/productos", label: "nav.products", icon: ShoppingBag },
      { href: "/pedidos", label: "nav.orders", icon: Receipt },
    ],
  },
  {
    title: "nav.groupAnalytics",
    items: [
      { href: "/metricas", label: "nav.metrics", icon: BarChart3 },
    ],
  },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
  /** Desktop-only — when true, sidebar shrinks to an icon-only rail. */
  collapsed?: boolean;
  /** Fired when the user clicks the collapse/expand toggle inside the
   *  sidebar. Mirrors the same toggle in the header. */
  onToggleCollapsed?: () => void;
}

export function Sidebar({
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  // usePathname() returns whatever language the URL is in (/inbox or
  // /bandeja). Canonicalize it so the nav's active-state logic — which is
  // written against the canonical Spanish hrefs — matches in either language.
  const pathname = canonicalizePath(usePathname());
  const searchParams = useSearchParams();
  // Recombinar pathname + ?param=valor para que NavLink pueda
  // distinguir entre /ajustes (general) y /ajustes?tab=workspace
  // (Equipo). Antes ambos se activaban juntos.
  const fullPath = searchParams.toString()
    ? `${pathname}?${searchParams.toString()}`
    : pathname;
  const { profile, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const { theme, setTheme } = useTheme();
  const setup = useSetupStatus();
  const t = useT();

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
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
      {/* Mobile backdrop. */}
      <button
        type="button"
        aria-label={t("nav.closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground",
          "border-r border-sidebar-border",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:translate-x-0 lg:transition-[width] lg:duration-200",
          collapsed ? "lg:w-16" : "lg:w-60",
        )}
        aria-label={t("nav.main")}
      >
        {/* Logo row — lowercase lime wordmark, matching Riverz. */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center justify-between gap-2",
            "pt-[env(safe-area-inset-top)] lg:pt-0",
            collapsed ? "px-4 lg:justify-center lg:px-2" : "px-4",
          )}
        >
          <Link
            href="/panel"
            aria-label="riverz"
            className={cn(
              "text-[20px] font-semibold lowercase leading-none tracking-[0.04em] text-sidebar-primary",
              collapsed && "lg:hidden",
            )}
          >
            riverz
          </Link>

          {/* Mobile close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.closeMenu")}
            className="rounded-md p-1 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
          {/* Desktop collapse / expand toggle. Centered when collapsed so the
              icon rail keeps a usable expand control. */}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
              title={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
              className={cn(
                "hidden rounded-md p-1 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:block",
                collapsed && "lg:mx-auto",
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {/* Main navigation */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto py-3 scrollbar-thin",
            collapsed ? "lg:px-2" : "px-3",
          )}
        >
          {navGroups.map((group) => (
            <div key={group.title} className="mb-4">
              <h3
                className={cn(
                  "app-sidebar-group mb-1.5 px-2.5",
                  collapsed && "lg:hidden",
                )}
              >
                {t(group.title)}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname} fullPath={fullPath}
                    collapsed={collapsed}
                    totalUnread={totalUnread}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Pie del sidebar: Equipo (promovido desde Ajustes porque es
            tarea de la primera semana), Integraciones (con badge
            pendiente hasta que WhatsApp y Shopify estén conectados) y
            Ajustes (perfil, workspace, apariencia). */}
        <div
          className={cn(
            "flex flex-col gap-0.5 border-t border-sidebar-border py-2",
            collapsed ? "lg:px-2" : "px-3",
          )}
        >
          <NavLink
            item={{ href: "/ajustes?tab=workspace", label: "nav.team", icon: UserRound }}
            pathname={pathname} fullPath={fullPath}
            collapsed={collapsed}
            totalUnread={0}
          />
          <NavLink
            item={{
              href: "/integraciones",
              label: "nav.integrations",
              icon: Blocks,
            }}
            pathname={pathname} fullPath={fullPath}
            collapsed={collapsed}
            totalUnread={0}
            setupPending={!setup.ready}
          />
          <NavLink
            item={{ href: "/ajustes", label: "nav.settings", icon: Settings }}
            pathname={pathname} fullPath={fullPath}
            collapsed={collapsed}
            totalUnread={0}
          />
          {/* Platform admin only — global voice model stack. Nav visibility is
              a client hint; the /api/admin route enforces the real gate. */}
          {isPlatformAdminClient(profile?.email) && (
            <NavLink
              item={{ href: "/admin/voz", label: "nav.adminVoiceModel", icon: SlidersHorizontal }}
              pathname={pathname} fullPath={fullPath}
              collapsed={collapsed}
              totalUnread={0}
            />
          )}
        </div>

        {/* User row + theme toggle */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-t border-sidebar-border p-3",
            "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
            collapsed && "lg:flex-col lg:gap-2 lg:p-2",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex min-w-0 flex-1 items-center rounded-lg text-left transition-colors hover:bg-sidebar-accent focus:bg-sidebar-accent focus:outline-none data-popup-open:bg-sidebar-accent",
                collapsed ? "lg:justify-center lg:p-1.5" : "gap-2.5 px-2 py-1.5",
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/15 text-sm font-medium text-sidebar-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
                <p className="truncate text-[13px] font-medium text-sidebar-foreground">
                  {profile?.full_name ?? t("nav.user")}
                </p>
                <p className="truncate text-[11px] text-sidebar-foreground/55">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/ajustes?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t("nav.profile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/ajustes"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t("nav.settings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t("nav.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Light / dark toggle — mirrors Riverz's sidebar control. */}
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={
              theme === "dark" ? t("nav.switchToLight") : t("nav.switchToDark")
            }
            title={theme === "dark" ? t("nav.lightTheme") : t("nav.darkTheme")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-sidebar-border text-sidebar-foreground/60 transition-colors hover:border-sidebar-primary hover:text-sidebar-primary"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

function NavLink({
  item,
  pathname,
  fullPath,
  collapsed,
  totalUnread,
  setupPending = false,
}: {
  item: NavItem;
  pathname: string;
  /** pathname + ?param=valor. Permite distinguir entre items que
   *  comparten pathname pero difieren en tab (ej. Equipo vs Ajustes). */
  fullPath: string;
  collapsed: boolean;
  totalUnread: number;
  /** Cuando Integraciones todavía no tiene WhatsApp+Shopify conectados,
   *  mostramos un chip "Conecta" para guiar el onboarding. */
  setupPending?: boolean;
}) {
  const t = useT();
  // Lógica de activo:
  //   1) Si el item.href tiene "?tab=X", es "qualified": solo se activa
  //      cuando el fullPath actual coincide exactamente con item.href.
  //      Antes Equipo (/ajustes?tab=workspace) y Ajustes (/ajustes) se
  //      activaban juntos porque ambos hacían pathname.startsWith
  //      ("/ajustes").
  //   2) Si el item.href NO tiene "?", se activa por prefix del pathname
  //      (comportamiento original — Bandeja activa para /bandeja/abc, etc.).
  //   3) Items "generales" (sin tab) NO se activan cuando hay un tab que
  //      apunta a su mismo pathname; si no, Ajustes se activaría también
  //      cuando estoy en /ajustes?tab=workspace.
  const itemPath = item.href.split("?")[0];
  const itemHasTab = item.href.includes("?");
  const currentTab = fullPath.includes("?")
    ? fullPath.split("?")[1]
    : null;
  let isActive = false;
  if (itemHasTab) {
    // Qualified: match exacto contra fullPath.
    isActive = fullPath === item.href;
  } else if (item.href === "/panel") {
    isActive = pathname === "/panel";
  } else {
    // General: pathname start with itemPath PERO solo si no hay un tab
    // en la URL actual (porque en ese caso el item "qualified" gana).
    const pathMatches = pathname === itemPath || pathname.startsWith(itemPath + "/");
    isActive = pathMatches && !currentTab;
  }
  if (
    !isActive &&
    item.alsoActiveOn?.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    isActive = true;
  }

  const showUnreadBadge =
    item.href === "/bandeja" && totalUnread > 0 && !isActive;
  const unreadLabel = totalUnread > 99 ? "99+" : String(totalUnread);

  const link = (
    <Link
      href={item.href}
      className={cn(
        "app-sidebar-link",
        "min-h-[44px] lg:min-h-0",
        collapsed && "lg:justify-center lg:px-0",
        isActive && "is-active",
      )}
    >
      <item.icon className="h-3.5 w-3.5 shrink-0" />
      <span className={cn("flex-1", collapsed && "lg:hidden")}>
        {t(item.label)}
      </span>
      {item.beta && !collapsed && (
        <span
          aria-label={t("nav.betaFeature")}
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
        >
          {t("nav.beta")}
        </span>
      )}
      {setupPending && !collapsed && (
        <span
          aria-label={t("nav.connectPending")}
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
        >
          {t("nav.connectCta")}
        </span>
      )}
      {showUnreadBadge && !collapsed && (
        <span
          aria-label={t("nav.unread", { n: totalUnread })}
          className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-semibold leading-none text-sidebar-primary-foreground"
        >
          {unreadLabel}
        </span>
      )}
      {showUnreadBadge && collapsed && (
        <span
          aria-label={t("nav.unread", { n: totalUnread })}
          className="absolute right-1 top-1 inline-flex min-w-[14px] items-center justify-center rounded-full bg-sidebar-primary px-1 text-[9px] font-semibold leading-none text-sidebar-primary-foreground lg:flex"
        >
          {unreadLabel}
        </span>
      )}
    </Link>
  );

  return (
    <li>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger render={link} />
          <TooltipContent side="right" sideOffset={8}>
            {t(item.label)}
          </TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}
