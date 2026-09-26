/**
 * Platform (super) admin gate — distinct from a workspace admin.
 *
 * A platform admin is the Riverz team: they open riverz.co/admin and change
 * global settings that affect every tenant (e.g. the voice model stack).
 * The allowlist is the built-in team list UNION `PLATFORM_ADMIN_EMAILS`
 * (comma-separated), so access never depends on an env var being set, and
 * extra admins can still be added without a deploy. The client mirror adds
 * `NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS` and only shows/hides the nav entry —
 * the server is the real gate.
 */

/**
 * Cuentas del equipo de Riverz. Siempre admins, con env o sin ella.
 *
 * `pilaroficialskin@hotmail.com` estuvo acá y se sacó: es la cuenta de un
 * COMERCIO. Un inquilino con acceso al panel de plataforma puede ver y tocar
 * los ajustes que afectan a todos los demás — y ni siquiera hacía falta que
 * quisiera: alcanzaba con que alguien entrara a esa sesión.
 */
export const TEAM_ADMINS = [
  'riverzoficial@gmail.com',
  'juandiegoriosmesa@gmail.com',
];

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Same mailbox → same person. Gmail ignores dots and everything after a `+`,
 * so `riverzoficial+test@gmail.com` is the owner's own inbox and must not
 * lose admin access over an alias.
 */
function normalize(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at === -1) return e;
  const domain = e.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return e;
  const local = e.slice(0, at).split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}

function allowlist(extra: string | undefined): Set<string> {
  const fromEnv = (extra ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...TEAM_ADMINS, ...fromEnv].map(normalize));
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowlist(process.env.PLATFORM_ADMIN_EMAILS).has(normalize(email));
}

// Acá vivía `isPlatformAdminClient`, un espejo de esto para el navegador que
// leía `NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS`. No lo importaba nadie: su único uso
// previsto era esconder o mostrar una entrada de menú, y el sidebar
// deliberadamente no tiene ninguna al panel. Exponer la lista del equipo en el
// bundle del cliente a cambio de nada no es un intercambio que valga la pena;
// quien necesite el dato del lado del cliente que lo reciba por props desde el
// layout, que ya resuelve `isPlatformAdmin` en el servidor.
