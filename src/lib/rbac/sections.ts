/**
 * RBAC — per-member menu access.
 *
 * A workspace member's `allowed_sections` (on workspace_members / carried on
 * workspace_invites) gates which sidebar sections they can open:
 *   - null / undefined → full access (owners, admins, legacy members).
 *   - a string[]       → only those section keys (canonical route prefixes).
 *
 * Keys are the canonical Spanish route prefixes; labels reuse the `nav` i18n
 * catalog. Enforcement is the sidebar filter + a client route guard; workspace
 * data stays RLS-scoped to membership regardless.
 */

export interface GateableSection {
  /** Canonical route prefix, e.g. "/bandeja". */
  key: string;
  /** i18n key in the `nav` namespace. */
  labelKey: string;
}

export const GATEABLE_SECTIONS: GateableSection[] = [
  { key: "/chat", labelKey: "nav.chat" },
  { key: "/panel", labelKey: "nav.home" },
  { key: "/bandeja", labelKey: "nav.inbox" },
  { key: "/contactos", labelKey: "nav.contacts" },
  { key: "/asistente", labelKey: "nav.assistant" },
  { key: "/comentarios", labelKey: "nav.comments" },
  { key: "/menus", labelKey: "nav.flows" },
  { key: "/voz", labelKey: "nav.voice" },
  { key: "/chat-web", labelKey: "nav.webchat" },
  { key: "/campanas", labelKey: "nav.campaigns" },
  { key: "/automatizaciones", labelKey: "nav.automations" },
  { key: "/plantillas", labelKey: "nav.templates" },
  { key: "/agente-instagram", labelKey: "nav.instagramAgent" },
  { key: "/productos", labelKey: "nav.products" },
  { key: "/pedidos", labelKey: "nav.orders" },
  { key: "/devoluciones", labelKey: "nav.returns" },
  { key: "/aprobaciones", labelKey: "nav.approvals" },
  { key: "/integraciones", labelKey: "nav.integrations" },
];

export const GATEABLE_KEYS: string[] = GATEABLE_SECTIONS.map((s) => s.key);

/** Always reachable regardless of grants — own profile / settings. */
const ALWAYS_ALLOWED = ["/ajustes"];

/** Keep only real, de-duplicated gateable keys from arbitrary input. */
export function sanitizeSections(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set(GATEABLE_KEYS);
  return [...new Set(input.filter((s): s is string => typeof s === "string" && valid.has(s)))];
}

/**
 * Can a member whose grant is `allowed` reach the CANONICAL `path`?
 *   allowed == null → full access. Callers must canonicalize the path first
 *   (nav hrefs are already canonical).
 */
export function canAccessSection(
  allowed: string[] | null | undefined,
  path: string,
): boolean {
  if (allowed == null) return true;
  if (
    ALWAYS_ALLOWED.some(
      (a) => path === a || path.startsWith(a + "/") || path.startsWith(a + "?"),
    )
  ) {
    return true;
  }
  // Most-specific gateable prefix wins (none of ours nest, but future-proof).
  const match = GATEABLE_KEYS.filter(
    (k) => path === k || path.startsWith(k + "/") || path.startsWith(k + "?"),
  ).sort((a, b) => b.length - a.length)[0];
  if (!match) return true; // ungated route (internal/misc) — never block
  return allowed.includes(match);
}
