/**
 * Defensa SSRF para URLs provistas por el usuario que luego se usan como
 * destino de scraping/fetch del lado servidor (o se envían a un servicio
 * externo como Firecrawl que las fetchea por nosotros).
 *
 * Exige https y rechaza hosts que no deberían ser alcanzables: loopback,
 * rangos privados RFC1918, CGNAT, link-local (incluida la IP de metadata
 * cloud 169.254.169.254) y literales IPv6 internos. También rechaza URLs
 * con credenciales embebidas (user:pass@host).
 *
 * Nota: esto bloquea los casos obvios por hostname/IP literal. No resuelve
 * DNS, así que un dominio público que apunte a una IP interna (DNS
 * rebinding) no se detecta aquí; esa mitigación corresponde a quien hace el
 * fetch final. Aun así cierra el vector directo de pasar IPs/hosts internos.
 */
export function isPublicHttpsUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (isBlockedHost(u.hostname.toLowerCase())) return null;
  return u;
}

function isBlockedHost(host: string): boolean {
  // IPv6 entre corchetes -> quitar corchetes
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true;

  // IPv4 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127) return true; // este host / loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local / metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }

  // IPv6 literal interno
  if (h.includes(':')) {
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
    if (h.startsWith('fe80')) return true; // link-local
    if (h.startsWith('::ffff:')) return true; // IPv4-mapped (p.ej. ::ffff:127.0.0.1)
  }

  return false;
}
