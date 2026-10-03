/** This repository ships Dealers only. The legacy mode is isolated to regression tests. */
export function isDealerDeployment() {
  return process.env.NODE_ENV !== 'test' || process.env.NEXT_PUBLIC_RIVERZ_VERTICAL !== 'ecommerce';
}
