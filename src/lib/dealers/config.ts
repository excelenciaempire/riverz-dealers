/** Dealers is the default vertical of this independent repository. */
export function isDealerDeployment() {
  return process.env.NEXT_PUBLIC_RIVERZ_VERTICAL !== 'ecommerce';
}
