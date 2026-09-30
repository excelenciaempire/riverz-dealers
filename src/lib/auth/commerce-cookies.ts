/** Separate cookie namespace: changing stores never replaces the admin login. */
export const COMMERCE_AUTH_COOKIE = 'riverz-commerce-auth';
export const COMMERCE_CONTEXT_COOKIE = 'riverz-commerce-context';
export const COMMERCE_SELECTION_COOKIE = 'riverz-commerce-selection';
export const COMMERCE_CHANGE_KEY = 'riverz.commerce.changed';
export const COMMERCE_TTL_SECONDS = 12 * 60 * 60;

export function selectedCommerceInBrowser(): string | null {
  if (typeof document === 'undefined') return null;
  const part = document.cookie.split(';').map((v) => v.trim())
    .find((v) => v.startsWith(`${COMMERCE_SELECTION_COOKIE}=`));
  const id = part?.slice(COMMERCE_SELECTION_COOKIE.length + 1);
  return id && /^[a-f0-9-]{36}$/i.test(id) ? id : null;
}
